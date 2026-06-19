/**
 * CV persistence module (CVPROF-003).
 *
 * Owns versioned CV uploads. The CV binary is copied to a file under the
 * Electron `userData` directory (NFR-001) — never the bundled app dir — and
 * its metadata + extracted plain text live in `star.db` alongside the
 * Profile, sites, and jobs stores. Re-uploading creates a NEW row with
 * `version = max(version)+1` so prior CVs are retained by default (FR-006).
 *
 * Text extraction is delegated to the CVPROF-002 off-thread extractor via
 * an injected `extractor` callback so this module stays unit-testable and
 * does not pull pdfjs-dist / mammoth into the test environment.
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   cv:upload | cv:list | cv:get
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { IpcMain } from 'electron';

export type CvMime = 'pdf' | 'docx';

export interface CvRecord {
  id: string;
  profileId: string;
  fileName: string;
  mime: CvMime;
  /** Path RELATIVE to the storage root, with forward slashes — portable
   *  across platforms (AC7). Resolve with path.resolve(storageRoot, ...). */
  storagePath: string;
  parsedText: string;
  parsedFields: Record<string, unknown> | null;
  version: number;
  confidence: number | null;
  uploadedAt: number;
}

export interface UploadCvInput {
  filePath: string;
  fileName: string;
  mime: CvMime;
  profileId?: string;
}

export interface CvExtractorResult {
  text: string;
  mime: CvMime;
  chars: number;
}

export type CvExtractor = (input: {
  filePath: string;
  mime: CvMime;
}) => Promise<CvExtractorResult>;

export interface CvStoreOptions {
  /** Absolute directory under which CV binaries are stored. Typically
   *  `app.getPath('userData')`. */
  storageRoot: string;
  /** Off-thread text extractor (CVPROF-002). */
  extractor: CvExtractor;
}

// Minimal slice of the better-sqlite3 surface we use — matches sites.ts /
// profile.ts so the store stays unit-testable with a lightweight fake.
export interface CvDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

/** Outcome of clearing every CV for a profile (CVPROF-014). */
export interface ClearCvResult {
  removedRows: number;
  removedFiles: number;
}

export interface CvStore {
  upload(input: UploadCvInput): Promise<CvRecord>;
  list(profileId?: string): CvRecord[];
  get(id: string): CvRecord | null;
  clear(profileId?: string): Promise<ClearCvResult>;
}

export const MAX_CV_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PROFILE_ID = 'singleton';

const SUPPORTED_MIMES: ReadonlyArray<CvMime> = ['pdf', 'docx'];

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cv (
    id             TEXT PRIMARY KEY,
    profile_id     TEXT NOT NULL,
    file_name      TEXT NOT NULL,
    mime           TEXT NOT NULL,
    storage_path   TEXT NOT NULL,
    parsed_text    TEXT,
    parsed_fields  TEXT,
    version        INTEGER NOT NULL,
    confidence     REAL,
    uploaded_at    INTEGER NOT NULL
  )
`;

interface CvRow {
  id: string;
  profile_id: string;
  file_name: string;
  mime: string;
  storage_path: string;
  parsed_text: string | null;
  parsed_fields: string | null;
  version: number;
  confidence: number | null;
  uploaded_at: number;
}

function coerceMime(value: unknown): CvMime | null {
  return SUPPORTED_MIMES.includes(value as CvMime) ? (value as CvMime) : null;
}

function parseFieldsJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowToRecord(row: CvRow): CvRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    fileName: row.file_name,
    mime: (coerceMime(row.mime) ?? 'pdf') as CvMime,
    storagePath: row.storage_path,
    parsedText: row.parsed_text ?? '',
    parsedFields: parseFieldsJson(row.parsed_fields),
    version: row.version,
    confidence: row.confidence,
    uploadedAt: row.uploaded_at,
  };
}

/**
 * Turn an OS-specific path into a portable, forward-slash relative path
 * suitable for persistence (AC7). Resolved against the storage root with
 * `path.resolve` when the binary is read back.
 */
function toPortable(p: string): string {
  return p.split(path.sep).join('/');
}

export function createCvStore(db: CvDatabaseLike, opts: CvStoreOptions): CvStore {
  db.exec(CREATE_TABLE_SQL);

  const insertStmt = db.prepare(
    `INSERT INTO cv (
       id, profile_id, file_name, mime, storage_path,
       parsed_text, parsed_fields, version, confidence, uploaded_at
     ) VALUES (
       @id, @profile_id, @file_name, @mime, @storage_path,
       @parsed_text, @parsed_fields, @version, @confidence, @uploaded_at
     )`,
  );
  const selectByIdStmt = db.prepare('SELECT * FROM cv WHERE id = ?');
  const listByProfileStmt = db.prepare(
    'SELECT * FROM cv WHERE profile_id = ? ORDER BY version DESC',
  );
  const maxVersionStmt = db.prepare(
    'SELECT MAX(version) AS max_version FROM cv WHERE profile_id = ?',
  );
  // Prepared lazily so existing test fakes that pre-date CVPROF-014 still
  // recognise the SQL surface they were written against — only the new
  // clear path needs the DELETE statement.
  let deleteByProfileStmt: { run(...args: unknown[]): unknown } | null = null;
  const ensureDeleteStmt = () => {
    if (!deleteByProfileStmt) {
      deleteByProfileStmt = db.prepare('DELETE FROM cv WHERE profile_id = ?');
    }
    return deleteByProfileStmt;
  };

  function nextVersion(profileId: string): number {
    const rows = (maxVersionStmt.all?.(profileId) ?? []) as Array<{
      max_version: number | null;
    }>;
    const current = rows[0]?.max_version ?? 0;
    return (current ?? 0) + 1;
  }

  return {
    async upload(input: UploadCvInput): Promise<CvRecord> {
      const mime = coerceMime(input.mime);
      if (!mime) {
        throw new Error(
          `Unsupported file type "${String(input.mime)}". Only PDF and DOCX CV uploads are supported.`,
        );
      }
      const fileName = (input.fileName ?? '').trim();
      if (!fileName) throw new Error('CV fileName is required');
      const profileId = input.profileId || DEFAULT_PROFILE_ID;

      let size: number;
      try {
        size = (await stat(input.filePath)).size;
      } catch (err) {
        throw new Error(
          `Failed to read CV at ${input.filePath}: ${(err as Error).message}`,
        );
      }
      if (size > MAX_CV_BYTES) {
        throw new Error(
          `CV is too large (${size} bytes). The maximum supported size is 10MB.`,
        );
      }

      const version = nextVersion(profileId);
      const id = randomUUID();
      const ext = mime === 'pdf' ? '.pdf' : '.docx';
      // Versioned, per-profile path under <userData>/cv/<profileId>/.
      const relDir = path.join('cv', profileId);
      const absDir = path.resolve(opts.storageRoot, relDir);
      await mkdir(absDir, { recursive: true });
      const baseName = `${version}-${id}${ext}`;
      const absFile = path.join(absDir, baseName);
      await copyFile(input.filePath, absFile);

      // Extract text off the UI thread via the injected extractor. The
      // extractor reads from the now-persisted copy so the renderer's source
      // path can disappear without breaking the record.
      const extracted = await opts.extractor({ filePath: absFile, mime });

      const storagePath = toPortable(path.join(relDir, baseName));
      const rec: CvRecord = {
        id,
        profileId,
        fileName,
        mime,
        storagePath,
        parsedText: extracted.text,
        parsedFields: null,
        version,
        confidence: null,
        uploadedAt: Date.now(),
      };
      insertStmt.run({
        id: rec.id,
        profile_id: rec.profileId,
        file_name: rec.fileName,
        mime: rec.mime,
        storage_path: rec.storagePath,
        parsed_text: rec.parsedText,
        parsed_fields: rec.parsedFields ? JSON.stringify(rec.parsedFields) : null,
        version: rec.version,
        confidence: rec.confidence,
        uploaded_at: rec.uploadedAt,
      });
      return rec;
    },

    list(profileId: string = DEFAULT_PROFILE_ID): CvRecord[] {
      const rows = (listByProfileStmt.all?.(profileId) ?? []) as CvRow[];
      return rows.map(rowToRecord);
    },

    get(id: string): CvRecord | null {
      const rows = (selectByIdStmt.all?.(id) ?? []) as CvRow[];
      const row = rows[0];
      return row ? rowToRecord(row) : null;
    },

    /**
     * Remove every CV row for the profile AND unlink each row's on-disk
     * binary (CVPROF-014). Unlink failures are tolerated row-by-row so an
     * already-missing file doesn't leave the DB row behind, but the count
     * of *successfully* removed files is returned so the caller can
     * surface partial cleanup.
     */
    async clear(profileId: string = DEFAULT_PROFILE_ID): Promise<ClearCvResult> {
      const rows = (listByProfileStmt.all?.(profileId) ?? []) as CvRow[];
      let removedFiles = 0;
      for (const row of rows) {
        const abs = path.resolve(opts.storageRoot, row.storage_path);
        try {
          await unlink(abs);
          removedFiles += 1;
        } catch {
          // best-effort — a missing file is not a hard failure (the
          // user could have deleted it manually); we still clear the row.
        }
      }
      const res = ensureDeleteStmt().run(profileId) as { changes?: number };
      return {
        removedRows: typeof res?.changes === 'number' ? res.changes : rows.length,
        removedFiles,
      };
    },
  };
}

/**
 * Open a SQLite database file backing the CV store. In practice the same
 * `star.db` handle opened in `electron-main.ts` for sites / profile is
 * reused — this helper exists so callers don't need to import `better-sqlite3`
 * directly.
 */
export function openCvDatabase(filepath: string): CvDatabaseLike {
  return new Database(filepath) as unknown as CvDatabaseLike;
}

/**
 * Register the `cv:upload`, `cv:list`, `cv:get` IPC handlers. Each handler
 * is `async` so the renderer's UI thread is never blocked — mirroring
 * registerSitesIpc / registerProfileIpc.
 */
export function registerCvIpc(ipcMain: IpcMain, store: CvStore): void {
  ipcMain.handle('cv:upload', async (_event, input: UploadCvInput) => store.upload(input));
  ipcMain.handle('cv:list', async (_event, profileId?: string) => store.list(profileId));
  ipcMain.handle('cv:get', async (_event, id: string) => store.get(id));
  ipcMain.handle('cv:clear', async (_event, profileId?: string) =>
    store.clear(profileId),
  );
}
