// job-board-store.ts
//
// The app's internal job board. JSON-backed (in Electron's userData dir), keyed by a
// stable `sourceId` so re-imports only add genuinely new jobs. Also caches the CSS
// selectors discovered for each site so we don't re-learn a layout every run.
//
// Scale-up path: swap the JSON file for better-sqlite3 — the function surface stays the same.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type JobStatus = 'new' | 'seen' | 'not_interested';

export interface JobStub {
  sourceId: string; // stable unique id, e.g. "linkedin:3891234567"
  url: string; // detail page URL
  title?: string;
  company?: string;
}

export interface JobRecord extends JobStub {
  title: string;
  company: string;
  location?: string;
  workplaceType?: string; // remote / hybrid / onsite
  employmentType?: string; // full-time / contract / ...
  salary?: string;
  postedDate?: string;
  description?: string; // full plain-text description
  applyUrl?: string;
  status: JobStatus;
  importedAt: string; // ISO timestamp
}

export interface SiteProfile {
  hostname: string;
  cardSelector: string; // matches each job card/row in the results list
  linkSelector?: string; // <a> inside a card whose href is the detail page
  nextSelector?: string; // control that loads the next page (omit for infinite scroll / none)
  idFromUrl?: string; // optional regex (with a capture group) to pull the job id out of a URL
}

interface StoreData {
  jobs: Record<string, JobRecord>;
  sites: Record<string, SiteProfile>;
}

let cache: StoreData | null = null;
const filePath = () => path.join(app.getPath('userData'), 'job-board.json');

function load(): StoreData {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as StoreData;
  } catch {
    cache = { jobs: {}, sites: {} };
  }
  return cache;
}

function save(): void {
  if (!cache) return;
  const tmp = filePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, filePath()); // atomic-ish
}

/** Every sourceId we already know about (imported OR flagged not-interested). */
export function knownSourceIds(): Set<string> {
  return new Set(Object.keys(load().jobs));
}

/** Insert records whose sourceId is not already present. Existing jobs (and their
 *  user-set status) are left untouched. Returns how many were newly inserted. */
export function upsertJobs(records: JobRecord[]): number {
  const data = load();
  let inserted = 0;
  for (const r of records) {
    if (!data.jobs[r.sourceId]) {
      data.jobs[r.sourceId] = r;
      inserted++;
    }
  }
  save();
  return inserted;
}

export function listJobs(filter?: { status?: JobStatus; excludeStatus?: JobStatus }): JobRecord[] {
  let arr = Object.values(load().jobs);
  if (filter?.status) arr = arr.filter((j) => j.status === filter.status);
  if (filter?.excludeStatus) arr = arr.filter((j) => j.status !== filter.excludeStatus);
  return arr.sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1)); // newest first
}

export function setStatus(sourceId: string, status: JobStatus): boolean {
  const data = load();
  if (!data.jobs[sourceId]) return false;
  data.jobs[sourceId].status = status;
  save();
  return true;
}

export function getSiteProfile(hostname: string): SiteProfile | null {
  return load().sites[hostname] ?? null;
}

export function saveSiteProfile(profile: SiteProfile): void {
  const data = load();
  data.sites[profile.hostname] = profile;
  save();
}
