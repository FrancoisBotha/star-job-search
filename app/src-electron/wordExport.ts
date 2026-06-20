/**
 * Word (.docx) export core (UEXP-002 / Epic 12 Unified Export).
 *
 * Main-process module that maps an Epic 7/9 approved tailored doc
 * (structured CV + optional cover letter) onto a deterministic,
 * single-column, ATS-safe `.docx` document using the pinned `docx`
 * library (UEXP-001).
 *
 * Design contract (mirrors `pdfExport.ts` so both targets agree on rules):
 *   - Single column body, standard section headings, real selectable
 *     UTF-8 text. No tables for body content, no text boxes, no images
 *     (FR-005 / NFR-002).
 *   - Standard ATS-safe font (Calibri) declared at the document defaults
 *     so the layout is consistent across Word, Pages and Google Docs
 *     without depending on a system-installed exotic typeface (FR-005).
 *   - Locale-appropriate page size: US/CA → US Letter (8.5" x 11"),
 *     everything else → A4 (210mm x 297mm) (FR-005). Margins held
 *     constant across paper sizes.
 *   - Content is run through the shared Epic 7/9
 *     {@link normalisePunctuation} BEFORE writing so smart quotes /
 *     em-dashes / ellipses become ASCII (FR-005 / FR-007). The `docx`
 *     library then XML-escapes every TextRun, so untrusted CV/JD text
 *     cannot inject OOXML tags into `word/document.xml` (NFR-004).
 *   - Render-only / content-faithful: every line of output corresponds
 *     to a supplied content field. `suggestions` and `gaps` are
 *     intentionally NOT emitted (NFR-001).
 *   - Offline by construction: no `fetch` / `node:net` / `node:https`
 *     / LLM client imports. Generation is fully local (FR-007 / NFR-003).
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

import { normalisePunctuation } from './atsCheck';
import type { CoverLetter, TailoredCv } from './tailor';

/** Optional contact-block fields. None of them are fabricated — when the
 *  caller does not supply a field the renderer simply omits it. */
export interface ContactBlock {
  name?: string;
  email?: string;
  phone?: string;
  url?: string;
  location?: string;
}

export interface WordExportInput {
  cv: TailoredCv;
  coverLetter?: CoverLetter;
  contact?: ContactBlock;
  /** BCP-47 locale tag. US + Canada → Letter, anything else → A4.
   *  Omit to default to A4. */
  locale?: string;
}

/** ATS-safe standard font. Calibri is the modern Word default — present
 *  on Word / Pages / Google Docs without an embedding step, and parsed
 *  cleanly by major ATS engines. */
const DEFAULT_FONT = 'Calibri';

/** Body font size in half-points. 22 == 11pt — recruiter-grade. */
const BODY_HALF_POINTS = 22;

/** Page sizes in twips (1 inch = 1440 twips). */
const PAGE_SIZE_LETTER = { width: 12240, height: 15840 } as const; // 8.5" x 11"
const PAGE_SIZE_A4 = { width: 11906, height: 16838 } as const; // 210 x 297 mm

/** Locales served Letter rather than A4 — North-American convention. */
const LETTER_LOCALES = new Set(['en-US', 'en-CA', 'fr-CA']);

function normaliseLocale(locale: string | undefined): string {
  if (!locale) return '';
  return locale
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/^([a-z]+)-([a-z]+)$/, (_m, lang, region) => `${lang}-${region.toUpperCase()}`);
}

/** Map a BCP-47 locale tag to a docx page size. Pure: same input → same
 *  output. */
export function selectDocxPageSize(locale: string | undefined): { width: number; height: number } {
  const norm = normaliseLocale(locale);
  return LETTER_LOCALES.has(norm) ? { ...PAGE_SIZE_LETTER } : { ...PAGE_SIZE_A4 };
}

/** Apply the Epic 7/9 normaliser to a string. The `docx` library does
 *  the XML escaping when it serialises a TextRun, so we only need to
 *  ASCII-normalise here; passing the result into a TextRun guarantees
 *  `<`, `>`, `&`, `"` all become entities in `word/document.xml`. */
function safe(text: string): string {
  return normalisePunctuation(text);
}

function runOf(text: string): TextRun {
  return new TextRun({ text: safe(text), font: DEFAULT_FONT, size: BODY_HALF_POINTS });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({ children: [runOf(text)] });
}

function headingParagraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new TextRun({ text: safe(text), font: DEFAULT_FONT, bold: true, size: 28 }),
    ],
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    children: [runOf(text)],
  });
}

function renderContact(contact: ContactBlock | undefined): Paragraph[] {
  if (!contact) return [];
  const paragraphs: Paragraph[] = [];
  if (contact.name) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: safe(contact.name), font: DEFAULT_FONT, bold: true, size: 32 }),
        ],
      }),
    );
  }
  const detail: string[] = [];
  if (contact.email) detail.push(contact.email);
  if (contact.phone) detail.push(contact.phone);
  if (contact.location) detail.push(contact.location);
  if (contact.url) detail.push(contact.url);
  if (detail.length) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [runOf(detail.join('   '))],
      }),
    );
  }
  return paragraphs;
}

function renderCv(cv: TailoredCv): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  if (cv.summary) {
    paragraphs.push(headingParagraph('Summary'));
    paragraphs.push(bodyParagraph(cv.summary));
  }
  if (cv.competencies.length) {
    paragraphs.push(headingParagraph('Competencies'));
    for (const item of cv.competencies) paragraphs.push(bulletParagraph(item));
  }
  if (cv.achievementBullets.length) {
    paragraphs.push(headingParagraph('Achievements'));
    for (const item of cv.achievementBullets) paragraphs.push(bulletParagraph(item));
  }
  if (cv.keywords.length) {
    paragraphs.push(headingParagraph('Keywords'));
    paragraphs.push(bodyParagraph(cv.keywords.join(', ')));
  }
  return paragraphs;
}

function renderCoverLetter(letter: CoverLetter): Paragraph[] {
  const paragraphs: Paragraph[] = [headingParagraph('Cover Letter')];
  if (letter.opening) paragraphs.push(bodyParagraph(letter.opening));
  for (const para of letter.body) {
    if (para) paragraphs.push(bodyParagraph(para));
  }
  if (letter.closing) paragraphs.push(bodyParagraph(letter.closing));
  return paragraphs;
}

/**
 * Render the approved tailored CV (and optional cover letter) to a
 * `.docx` buffer.
 *
 * The output is a real Word OOXML package whose `word/document.xml` is
 * single-column, contains no table or text-box elements, declares the
 * standard Calibri font, and uses a locale-appropriate page size. Every
 * text fragment is ASCII-normalised through {@link normalisePunctuation}
 * and XML-escaped by the `docx` serialiser before it lands on disk.
 */
export async function renderTailoredDocToDocx(input: WordExportInput): Promise<Buffer> {
  const page = selectDocxPageSize(input.locale);
  const children: Paragraph[] = [
    ...renderContact(input.contact),
    ...renderCv(input.cv),
    ...(input.coverLetter ? renderCoverLetter(input.coverLetter) : []),
  ];

  const doc = new Document({
    creator: 'Star Job Search',
    title: 'Tailored CV',
    styles: {
      default: {
        document: {
          run: { font: DEFAULT_FONT, size: BODY_HALF_POINTS },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
          column: { count: 1 },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
