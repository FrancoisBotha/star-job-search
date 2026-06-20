<template>
  <div class="tailor">
    <!-- top bar -->
    <div class="bar">
      <q-btn flat dense no-caps class="bar__back" @click="goBack">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 3 5 8 9 13" /></svg>
        Starred
      </q-btn>

      <div class="segmented">
        <button class="seg" :class="{ 'is-active': store.tailorTab === 'cv' }" @click="store.tailorTab = 'cv'">Tailored CV</button>
        <button class="seg" :class="{ 'is-active': store.tailorTab === 'letter' }" @click="store.tailorTab = 'letter'">Cover letter</button>
      </div>

      <div class="bar__right">
        <!-- Live star/% chip — reads the deterministic Epic 5 score store
             so the chip updates as soon as an Accept triggers a rescore (FR-012). -->
        <div v-if="liveScore" class="meter" data-test="live-match">
          <span class="font-mono meter__label">MATCH</span>
          <StarRating :score="liveScore.stars" />
          <span class="font-mono meter__to">{{ Math.round(liveScore.percent) }}%</span>
        </div>

        <!-- Intensity toggle (FR-013): light ↔ aggressive. -->
        <div class="segmented intensity" role="group" aria-label="Tailoring intensity">
          <button
            class="seg"
            :class="{ 'is-active': intensity === 'light' }"
            data-test="intensity-light"
            @click="setIntensity('light')"
          >Light touch</button>
          <button
            class="seg"
            :class="{ 'is-active': intensity === 'aggressive' }"
            data-test="intensity-aggressive"
            @click="setIntensity('aggressive')"
          >Aggressive</button>
        </div>

        <q-btn outline no-caps label="Copy" :disable="!doc" @click="copy" />
        <q-btn
          v-if="kind === 'cover-letter'"
          outline no-caps label="Export text"
          data-test="export-text"
          :disable="!doc"
          @click="onExportText"
        />
        <q-btn unelevated color="primary" no-caps label="Export Markdown" :disable="!doc" @click="onExport" />

        <!-- Page-size choice for PDF export (PDFEX-005 / AC3). Defaults
             by locale: en-US → Letter, everywhere else → A4. Reuses the
             same `segmented` Studio chrome as the tab + intensity
             switches so no new design tokens are introduced (AC6). -->
        <div class="segmented" role="group" aria-label="PDF page size">
          <button
            class="seg"
            :class="{ 'is-active': pdfPageSize === 'letter' }"
            data-test="pdf-page-size-letter"
            @click="pdfPageSize = 'letter'"
          >Letter</button>
          <button
            class="seg"
            :class="{ 'is-active': pdfPageSize === 'a4' }"
            data-test="pdf-page-size-a4"
            @click="pdfPageSize = 'a4'"
          >A4</button>
        </div>

        <!-- Export PDF — visible on both CV and Cover-letter tabs
             (AC1). Disabled until a tailored doc exists (AC2). -->
        <q-btn
          unelevated color="primary" no-caps
          label="Export PDF"
          data-test="export-pdf"
          :disable="!doc"
          :loading="isExportingPdf"
          @click="onExportPdf"
        />
      </div>
    </div>

    <!-- PDF export progress / error / success banners (AC3 / AC4 / AC5).
         Compile state shows a banner while the bundled LaTeX engine runs;
         on error we surface a stable-code-driven message + Try-again; on
         success the last record's provenance is pinned under the bar so
         the user always sees what was exported and when. -->
    <div
      v-if="isExportingPdf"
      class="banner banner--stale"
      data-test="pdf-exporting"
    >
      <q-spinner color="primary" size="14px" />
      <span class="banner__text">Compiling PDF…</span>
    </div>

    <div
      v-if="pdfExportState.status === 'error'"
      class="banner banner--error"
      data-test="pdf-export-error"
    >
      <span class="banner__text">{{ pdfErrorCopy }}</span>
      <q-btn flat dense no-caps color="primary" label="Try again" @click="onExportPdf" />
    </div>

    <div
      v-if="lastPdfRecord"
      class="banner banner--stale"
      data-test="pdf-export-provenance"
    >
      <span class="banner__text">
        exported from CV v{{ lastPdfRecord.tailoredDocVersion }} ·
        {{ formatExportDate(lastPdfRecord.exportedAt) }} ·
        {{ lastPdfRecord.pageSize === 'letter' ? 'Letter' : 'A4' }}
      </span>
      <q-btn
        flat dense no-caps color="primary" label="Reveal in folder"
        @click="onRevealLastPdf"
      />
    </div>

    <!-- Stale banner (FR-016) + Regenerate. -->
    <div v-if="doc?.stale" class="banner banner--stale">
      <span class="banner__text">This draft may be out of date — your CV or the job changed since it was generated.</span>
      <q-btn flat dense no-caps color="primary" label="Regenerate" @click="onGenerate" />
    </div>

    <!-- Error banner — code-driven copy (NFR-004). -->
    <div v-if="actionState.status === 'error'" class="banner banner--error" data-test="tailor-error">
      <span class="banner__text">{{ errorCopy }}</span>
      <q-btn v-if="canRetry" flat dense no-caps color="primary" label="Try again" @click="onGenerate" />
    </div>

    <!-- TDE-007 AC4: code-driven copy for the TDE-005 engine error codes
         (NO_API_KEY / NO_DEFAULT_MODEL / NO_DOC / MODEL_NOT_CAPABLE /
         RATE_LIMITED / NETWORK / LLM_ERROR / SCHEMA_ERROR). The CV tab uses
         this banner; the cover-letter tab still reads `actionState`. -->
    <div
      v-if="engineState.status === 'error'"
      class="banner banner--error"
      data-test="tailor-engine-error"
    >
      <span class="banner__text">{{ engineErrorCopy }}</span>
      <q-btn v-if="canRetryEngine" flat dense no-caps color="primary" label="Try again" @click="onGenerate" />
    </div>

    <div class="tailor__body">
      <!-- document canvas -->
      <div class="canvas app-scroll">
        <!-- Generating spinner (FR-014). Engine-side "propose" also surfaces
             here so the CV tab shows a spinner while the LangGraph pipeline
             is in flight (TDE-007 AC4). -->
        <div v-if="(isGenerating && !doc) || (isProposing && !proposal)" class="loading">
          <q-spinner color="primary" size="32px" />
          <p class="loading__text">{{ isProposing ? 'Generating proposal…' : 'Generating tailored draft…' }}</p>
        </div>

        <!-- Empty / not-yet-generated state. -->
        <div v-else-if="!doc && !proposal" class="empty">
          <div class="font-serif empty__title">No draft yet</div>
          <p class="empty__sub">Generate a tailored {{ kind === 'cv' ? 'CV' : 'cover letter' }} for this job.</p>
          <q-btn unelevated color="primary" no-caps label="Generate" :disable="!tailoringAvailable" @click="onGenerate" />
        </div>

        <!-- CV view: TDE-007 engine proposal (per-change accept/reject diff)
             on top, then the persisted base-vs-tailored diff after the user
             clicks Apply (FR-003 + Epic 9 §8). -->
        <div v-else-if="kind === 'cv'" class="paper paper--diff">
          <div class="provenance" data-test="provenance">
            <span class="provenance__tag">AI draft · advisory</span>
            <span class="provenance__meta">{{ provenanceLabel }}</span>
            <span v-if="store.currentCv" class="provenance__meta">built from CV v{{ store.currentCv.version }}</span>
          </div>

          <!-- Per-node progress chip (TDE-006 progress stream / TDE-007 AC4).
               extract-jd-signals → plan-skills → generate-diffs → gate-filter
               → refine → rescore. -->
          <div
            v-if="engineProgress"
            class="engine-progress"
            data-test="engine-progress"
          >
            <span class="engine-progress__label font-mono">PIPELINE</span>
            <span class="engine-progress__phase">{{ phaseLabel(engineProgress.phase) }}</span>
            <span v-if="engineProgress.pass" class="engine-progress__pass font-mono">pass {{ engineProgress.pass }}</span>
            <span v-if="engineProgress.note" class="engine-progress__note">{{ engineProgress.note }}</span>
          </div>

          <!-- Engine proposal panel — per-change accept/reject diff with the
               gate-validated reason, plus before→after match % from the
               RefinementStats (TDE-007 AC1 + AC2). -->
          <section
            v-if="proposal"
            class="proposal"
            data-test="tailor-proposal"
            aria-label="Tailoring proposal"
          >
            <header class="proposal__head">
              <h4 class="proposal__title">Proposed changes</h4>
              <span class="proposal__meta font-mono" data-test="match-delta">
                MATCH {{ Math.round(proposal.refinementStats.initialPercent) }}% →
                {{ Math.round(proposal.refinementStats.finalPercent) }}%
              </span>
              <q-btn
                outline no-caps dense
                label="Accept all"
                data-test="accept-all"
                :disable="!proposal.proposedChanges.length"
                @click="acceptAllChanges"
              />
              <q-btn
                unelevated color="primary" no-caps dense
                label="Apply changes"
                data-test="apply-accepted"
                :loading="isApplying"
                :disable="acceptedChangeIds.size === 0"
                @click="onApplyAccepted"
              />
            </header>

            <!-- High-risk warnings (TDE-007 AC2). Invented metrics, word-count
                 blow-ups, and the "no injectable keywords" exit reason are
                 flagged so the user can refuse a misleading edit before
                 Apply persists anything. -->
            <ul
              v-if="warningEntries.length"
              class="warnings"
              data-test="tailor-warnings"
              aria-label="High-risk warnings"
            >
              <li
                v-for="(w, idx) in warningEntries"
                :key="idx"
                class="warnings__item"
                :data-test="`warning-${w.kind}`"
              >
                <span class="warnings__kind font-mono">{{ warningKindLabel(w.kind) }}</span>
                <span class="warnings__text">{{ w.message }}</span>
              </li>
            </ul>

            <!-- Marker legend (TDE-007 AC1): every proposed change is tagged
                 with one of  +  (append / add_skill, new content) ;
                 ~  (replace, in-place modification) ;  –  (reorder, no new
                 content). The marker is visible per row via changeMarker(). -->
            <div class="changes__legend font-mono" aria-label="Change marker legend">
              <span>+ add</span> · <span>~ replace</span> · <span>– reorder</span>
            </div>
            <ul v-if="proposal.proposedChanges.length" class="changes">
              <li
                v-for="(c, idx) in proposal.proposedChanges"
                :key="idx"
                class="changes__item"
                :class="{ 'changes__item--accepted': acceptedChangeIds.has(idx) }"
                :data-test="`proposed-change-${idx}`"
              >
                <span class="changes__marker font-mono" :data-test="`marker-${c.action}`">{{ changeMarker(c.action) }}</span>
                <div class="changes__body">
                  <div class="changes__path font-mono">{{ c.path }} · {{ c.action }}</div>
                  <div class="changes__value">{{ renderChangeValue(c) }}</div>
                  <div class="changes__reason">{{ c.reason }}</div>
                </div>
                <div class="changes__actions">
                  <q-btn
                    dense unelevated color="primary" no-caps
                    :label="acceptedChangeIds.has(idx) ? 'Accepted' : 'Accept'"
                    data-test="change-accept"
                    @click="toggleAccept(idx)"
                  />
                  <q-btn
                    dense outline no-caps class="ghost"
                    label="Reject"
                    data-test="change-reject"
                    @click="rejectChange(idx)"
                  />
                </div>
              </li>
            </ul>
            <p v-else class="changes__empty">No proposed changes — the engine found nothing safe to apply.</p>
          </section>

          <div v-if="doc" class="cv__columns">
            <section class="cv__column" aria-label="Base CV">
              <div class="cv__col-head">Base CV</div>
              <pre class="cv__text">{{ baseText }}</pre>
            </section>
            <section class="cv__column cv__column--tailored" aria-label="Tailored CV">
              <div class="cv__col-head">Tailored CV</div>
              <div class="cv__text">
                <span
                  v-for="(seg, idx) in cvDiff"
                  :key="idx"
                  :class="diffClass(seg.kind)"
                >{{ seg.text }}</span>
              </div>
            </section>
          </div>
        </div>

        <!-- Cover-letter view (TAILOR-007). Editable in-place; the recipient
             company + title from the JD are surfaced inline so the reader can
             see what the draft is tailored to (AC1). The textarea is the
             single source of truth for Copy / Export-text / Export-Markdown
             so every edit flows through unchanged (AC2 / AC5). -->
        <div v-else class="paper letter letter-view" data-test="letter-view">
          <div class="provenance" data-test="provenance">
            <span class="provenance__tag">AI draft · advisory</span>
            <span class="provenance__meta">{{ provenanceLabel }}</span>
            <span v-if="store.currentCv" class="provenance__meta">built from CV v{{ store.currentCv.version }}</span>
          </div>

          <header class="letter__to" data-test="letter-to">
            <span class="letter__to-label font-mono">RE</span>
            <span class="letter__to-title" data-test="letter-title">{{ jobTitle || 'this role' }}</span>
            <span class="letter__to-sep">·</span>
            <span class="letter__to-company" data-test="letter-company">{{ jobCompany || 'this company' }}</span>
          </header>

          <textarea
            class="letter__editor"
            data-test="letter-editor"
            spellcheck="true"
            rows="18"
            v-model="letterContent"
          ></textarea>

          <!-- Gap-questions panel (FR-011 / AC3). Material gaps — domain,
               start date, seniority, language — are surfaced as questions
               the user answers; we never silently paper over them. Each
               question carries Confirm + Not applicable affordances. -->
          <section class="gaps gap-questions" data-test="gap-questions" aria-label="Open questions">
            <div class="gaps__head">
              <h4 class="gaps__title">Open questions</h4>
              <span class="gaps__sub">Confirm these gaps before sending — we don't paper them over.</span>
            </div>
            <p class="gaps__hint">
              We flag material gaps across domain, start date, seniority, and language so you can answer them in your own words.
            </p>
            <ul class="gaps__list">
              <li
                v-for="g in gapQuestions"
                :key="g.id"
                class="gaps__item"
                :data-test="`gap-question-${g.id}`"
              >
                <span class="gaps__category font-mono">{{ g.category }}</span>
                <p class="gaps__text">{{ g.question }}</p>
                <div class="gaps__actions">
                  <q-btn unelevated color="primary" no-caps dense label="Confirm" @click="onConfirmGap(g)" />
                  <q-btn outline no-caps dense label="Not applicable" @click="onSkipGap(g)" />
                </div>
              </li>
              <li v-if="!gapQuestions.length" class="gaps__empty">
                No material gaps flagged for this draft.
              </li>
            </ul>
          </section>
        </div>
      </div>

      <!-- suggestions + ATS dock -->
      <aside class="dock app-scroll">
        <div class="dock__head">
          <span class="dock__badge">★</span>
          <h4 class="dock__title">Star suggestions</h4>
          <span class="dock__left font-mono">{{ doc?.suggestions.length ?? 0 }} left</span>
        </div>
        <p class="dock__lead">Accept changes to align with this role — each lifts your match.</p>

        <div class="cards">
          <div v-for="s in doc?.suggestions ?? []" :key="s.id" class="card" :data-test="`suggestion-${s.id}`">
            <div class="card__head">
              <span class="tag tag--accent">{{ s.type }}</span>
              <span v-if="s.gain" class="gain font-mono">+{{ s.gain }}</span>
            </div>
            <p class="card__text">{{ s.text }}</p>
            <p v-if="s.rationale" class="card__rationale">{{ s.rationale }}</p>
            <div class="card__actions">
              <q-btn
                unelevated color="primary" no-caps dense class="col-grow"
                label="Accept"
                :loading="acceptingId === s.id"
                @click="onAccept(s.id)"
              />
              <q-btn outline no-caps dense class="ghost" label="Dismiss" @click="onDismiss(s.id)" />
            </div>
          </div>
          <p v-if="doc && doc.suggestions.length === 0" class="dock__empty">No suggestions left.</p>
        </div>

        <!-- ATS checklist panel (FR-009). -->
        <div v-if="doc" class="ats">
          <div class="ats__head">
            <h4 class="ats__title">ATS checklist</h4>
            <span class="ats__score font-mono">{{ doc.atsReport.score }}</span>
          </div>
          <ul class="ats__list">
            <li
              v-for="(c, idx) in doc.atsReport.checks ?? []"
              :key="idx"
              :class="{ 'ats__item--pass': c.passed, 'ats__item--fail': !c.passed }"
              :data-test="`ats-${c.passed ? 'pass' : 'fail'}`"
            >
              <span class="ats__mark">{{ c.passed ? '✓' : '✗' }}</span>
              <span class="ats__rule">{{ c.rule }}</span>
              <span v-if="!c.passed && c.detail" class="ats__detail">{{ c.detail }}</span>
            </li>
          </ul>
          <div v-if="doc.atsReport.missingKeywords.length" class="ats__missing">
            <span class="ats__missing-label font-mono">Missing keywords</span>
            <span v-for="k in doc.atsReport.missingKeywords" :key="k" class="skill skill--hl">{{ k }}</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import type { TailoredDocKind } from 'src/stores/app-store';

type StarTailorIntensity = 'light' | 'aggressive';

const router = useRouter();
const route = useRoute();
const store = useAppStore();
const $q = useQuasar();

/**
 * Deep-link source (AC1): the Tailor view keeps a named route and reads
 * `sourceId` off the query string so a Starred-page Generate click — or a
 * pasted URL — can land here directly.
 */
const sourceId = computed<string>(() => {
  const q = route.query.sourceId;
  return typeof q === 'string' ? q : '';
});

const kind = computed<TailoredDocKind>(() =>
  store.tailorTab === 'cv' ? 'cv' : 'cover-letter',
);

const doc = computed(() =>
  sourceId.value ? store.getTailoredDocCached(sourceId.value, kind.value) : null,
);

const actionState = computed(() =>
  sourceId.value
    ? store.tailorStateFor(sourceId.value, kind.value)
    : { status: 'idle' as const, code: null, message: null },
);

const isGenerating = computed(() => actionState.value.status === 'loading');

const liveScore = computed(() =>
  sourceId.value ? store.scores[sourceId.value] ?? null : null,
);

const intensity = ref<StarTailorIntensity>('light');
watch(doc, (d) => {
  if (d) intensity.value = d.intensity;
});

const acceptingId = ref<string | null>(null);

const tailoringAvailable = computed<boolean>(
  () => store.isTailoringAvailable && store.preferredModels.some((m) => m.isDefault),
);

const provenanceLabel = computed<string>(() => {
  if (!doc.value) return '';
  const date = new Date(doc.value.generatedAt).toISOString().slice(0, 10);
  return `AI draft · ${doc.value.modelSlug} · ${date}`;
});

const errorCopy = computed<string>(() => {
  const code = actionState.value.code;
  switch (code) {
    case 'NO_API_KEY':
      return 'No OpenRouter API key configured. Add one in Settings.';
    case 'NO_DEFAULT_MODEL':
      return 'No default model selected. Choose one in Settings.';
    case 'NO_CV':
      return 'Upload a CV in your profile before tailoring.';
    case 'MODEL_NOT_CAPABLE':
      return 'The selected model cannot return structured output. Choose another model in Settings.';
    case 'RATE_LIMITED':
      return 'Rate-limited by OpenRouter — try again in a moment.';
    case 'NETWORK_ERROR':
      return 'Network error reaching OpenRouter. Check your connection and try again.';
    case 'JOB_NOT_FOUND':
      return 'Job not found — it may have been removed.';
    case 'DRAFT_NOT_FOUND':
      return 'No draft to update — regenerate first.';
    case 'SUGGESTION_NOT_FOUND':
      return 'Suggestion no longer applies — refresh the draft.';
    case 'LLM_ERROR':
    case 'SCHEMA_ERROR':
      return actionState.value.message ?? 'The model returned an unexpected response.';
    default:
      return actionState.value.message ?? 'Something went wrong.';
  }
});

const canRetry = computed<boolean>(() => {
  const code = actionState.value.code;
  return code === 'RATE_LIMITED' || code === 'NETWORK_ERROR' || code === 'LLM_ERROR';
});

interface DiffSeg { kind: 'same' | 'add' | 'del'; text: string }

const baseText = computed<string>(() => store.currentCv?.parsedText ?? '');

/** Job recipient context for the cover-letter heading (TAILOR-007 / AC1):
 *  the letter must visibly target the JD's role + company so the user — and
 *  any reader — can see who/what the draft is tailored to. */
const jobRecord = computed(() => store.jobs.find((j) => j.sourceId === sourceId.value) ?? null);
const jobTitle = computed<string>(() => jobRecord.value?.title ?? '');
const jobCompany = computed<string>(() => jobRecord.value?.company ?? '');

/** Letter content as a writable computed (TAILOR-007 / AC2). Edits flow
 *  back into the cached doc so Copy + Export-as-text + Export-Markdown all
 *  read the latest in-place edit (FR-004 / FR-015). The renderer cache is
 *  the source of truth for an edit session; the underlying persisted draft
 *  is only refreshed on Regenerate / Accept. */
const letterContent = computed<string>({
  get(): string {
    return doc.value?.content ?? '';
  },
  set(next: string) {
    if (!sourceId.value || !doc.value) return;
    const key = `${sourceId.value}::cover-letter`;
    store.tailoredDocs[key] = { ...doc.value, content: next };
  },
});

/** Material-gap categories the cover-letter tab surfaces as questions
 *  (FR-011 / AC3). The four canonical buckets are domain, start date,
 *  seniority, and language — each gap question is keyed by category so the
 *  user answers in their own words rather than the model silently
 *  justifying or papering over the mismatch. */
interface CoverLetterGapQuestion {
  id: string;
  category: 'Domain' | 'Start date' | 'Seniority' | 'Language';
  question: string;
}

const GAP_CATEGORY_PATTERNS: Array<{ category: CoverLetterGapQuestion['category']; pattern: RegExp }> = [
  { category: 'Domain', pattern: /\b(domain|industry|sector|vertical)\b/i },
  { category: 'Start date', pattern: /\b(start[\s-]?date|notice|availability|available|start\s+by)\b/i },
  { category: 'Seniority', pattern: /\b(seniority|senior|junior|lead|staff|principal|level|years?\s+of\s+experience|yoe)\b/i },
  { category: 'Language', pattern: /\b(language|fluent|fluency|english|bilingual|native\s+speaker|written\s+and\s+spoken)\b/i },
];

function classifyGapCategory(text: string): CoverLetterGapQuestion['category'] | null {
  for (const { category, pattern } of GAP_CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/**
 * Filter the cached draft's suggestions for ones that read as material
 * gaps and convert them into user-facing questions. We do not invent
 * questions — if the model surfaced no gap-shaped suggestion for a
 * category, that category is simply absent (NFR-001 / AC4: never
 * fabricate). The renderer also draws on the CV-tab's cached draft so the
 * cover-letter inherits the same grounded gap evidence the CV side
 * surfaced.
 */
const answeredGapIds = ref<Set<string>>(new Set());

const gapQuestions = computed<CoverLetterGapQuestion[]>(() => {
  if (!sourceId.value) return [];
  const seen = new Set<string>();
  const out: CoverLetterGapQuestion[] = [];
  const drafts = [
    store.getTailoredDocCached(sourceId.value, 'cover-letter'),
    store.getTailoredDocCached(sourceId.value, 'cv'),
  ];
  for (const draft of drafts) {
    if (!draft) continue;
    for (const s of draft.suggestions) {
      const haystack = `${s.type ?? ''} ${s.text ?? ''} ${s.rationale ?? ''}`;
      const looksLikeGap = /gap|missing|cannot\s+find|no\s+evidence|cannot\s+verify|unclear/i.test(haystack);
      const category = classifyGapCategory(haystack);
      if (!category && !looksLikeGap) continue;
      const resolved: CoverLetterGapQuestion['category'] = category ?? 'Domain';
      const id = `${draft.kind}-${s.id}`;
      if (seen.has(id) || answeredGapIds.value.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        category: resolved,
        question: s.text || s.rationale || `Can you confirm your experience with ${s.type || 'this requirement'}?`,
      });
    }
  }
  return out;
});

function onConfirmGap(g: CoverLetterGapQuestion): void {
  answeredGapIds.value.add(g.id);
}
function onSkipGap(g: CoverLetterGapQuestion): void {
  answeredGapIds.value.add(g.id);
}

/**
 * Token-level diff so each edit on the tailored content is visible against
 * the base CV (FR-003). Cheap LCS over whitespace-split tokens — good enough
 * for the readable side-by-side view; the contract here is "every edit is
 * visible", not "minimal edit script".
 */
const cvDiff = computed<DiffSeg[]>(() => {
  if (!doc.value) return [];
  const base = (baseText.value || '').split(/(\s+)/);
  const tailored = (doc.value.content || '').split(/(\s+)/);
  return diffTokens(base, tailored);
});

function diffClass(k: DiffSeg['kind']): string {
  if (k === 'add') return 'diff diff-add';
  if (k === 'del') return 'diff diff-del';
  return 'diff diff-same';
}

function diffTokens(a: string[], b: string[]): DiffSeg[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1]! + 1) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: b[j]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // tokens removed from base — surface in the tailored column as 'del'
      // so the reader sees what was dropped.
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j]! });
    j += 1;
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i]! });
    i += 1;
  }
  return out;
}

function goBack(): void {
  void router.push({ name: 'starred' });
}

function setIntensity(next: StarTailorIntensity): void {
  if (intensity.value === next) return;
  intensity.value = next;
  if (sourceId.value && tailoringAvailable.value) {
    void store.generateTailoredDoc({
      sourceId: sourceId.value,
      kind: kind.value,
      intensity: next,
    });
  }
}

function onGenerate(): void {
  if (!sourceId.value) return;
  // TDE-007 AC1: the CV tab delegates to the TDE-005 diff engine; the
  // cover-letter tab still uses the Epic 7 free-text rewrite path
  // (generateTailoredDoc) — that path is explicitly untouched (AC4).
  if (kind.value === 'cv') {
    acceptedChangeIds.value = new Set();
    void store.proposeTailorEngine(sourceId.value);
    return;
  }
  void store.generateTailoredDoc({
    sourceId: sourceId.value,
    kind: kind.value,
    intensity: intensity.value,
  });
}

/* ------------------------------------------------------------------ */
/* TDE-007 — Tailor diff-engine wiring (CV tab only).                  */
/* ------------------------------------------------------------------ */
const proposal = computed(() =>
  sourceId.value ? store.tailorEngineProposals[sourceId.value] ?? null : null,
);
const engineState = computed(() =>
  sourceId.value
    ? store.tailorEngineStateFor(sourceId.value)
    : { status: 'idle' as const, code: null, message: null },
);
const isProposing = computed<boolean>(() => engineState.value.status === 'loading');
const isApplying = ref<boolean>(false);
const engineProgress = computed(() =>
  sourceId.value ? store.tailorEngineProgress[sourceId.value] ?? null : null,
);

/** Per-change acceptance — keyed by index into proposal.proposedChanges so
 *  Accept toggles, "Accept all", and Reject all stay O(1). Cleared on every
 *  new proposal request (see onGenerate). */
const acceptedChangeIds = ref<Set<number>>(new Set());

function toggleAccept(idx: number): void {
  const next = new Set(acceptedChangeIds.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  acceptedChangeIds.value = next;
}

function rejectChange(idx: number): void {
  const next = new Set(acceptedChangeIds.value);
  next.delete(idx);
  acceptedChangeIds.value = next;
}

function acceptAllChanges(): void {
  const all = proposal.value?.proposedChanges ?? [];
  acceptedChangeIds.value = new Set(all.map((_, i) => i));
}

function changeMarker(action: string): string {
  // +  appended/added (new content) ;  ~  in-place replace (modified) ;
  // –  reorder (re-arranged but no new content).
  if (action === 'append' || action === 'add_skill') return '+';
  if (action === 'replace') return '~';
  return '–';
}

function renderChangeValue(c: { value: unknown }): string {
  if (typeof c.value === 'string') return c.value;
  if (Array.isArray(c.value)) return c.value.join(', ');
  try {
    return JSON.stringify(c.value);
  } catch {
    return String(c.value);
  }
}

const PHASE_LABELS: Record<string, string> = {
  'extract-jd-signals': 'extract JD signals',
  'plan-skills': 'plan skills',
  'generate-diffs': 'generate diffs',
  'gate-filter': 'gate filter',
  refine: 'refine',
  rescore: 'rescore',
  done: 'done',
};
function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

function warningKindLabel(kind: string): string {
  if (kind === 'invented_metric') return 'invented metric';
  if (kind === 'word_count_blowup') return 'word-count jump';
  if (kind === 'no_injectable_keywords') return 'no injectable gap';
  return kind;
}

/** Surface refine warnings + a synthetic "non-injectable gap" entry when
 *  the refine loop exited because no keywords were injectable — the user
 *  must see that the engine couldn't close the gap so they don't assume
 *  silent success (TDE-007 AC2). */
interface ProposalWarning {
  kind: 'invented_metric' | 'word_count_blowup' | 'no_injectable_keywords';
  message: string;
  value: string;
}
const warningEntries = computed<ProposalWarning[]>(() => {
  const p = proposal.value;
  if (!p) return [];
  const out: ProposalWarning[] = [];
  for (const w of p.warnings) {
    out.push({ kind: w.kind as ProposalWarning['kind'], message: w.message, value: w.value });
  }
  if (p.refinementStats.exitReason === 'no_injectable_keywords') {
    out.push({
      kind: 'no_injectable_keywords',
      message:
        'Refine pass found no injectable keywords — gaps remain that the engine cannot close without inventing evidence.',
      value: '',
    });
  }
  return out;
});

const engineErrorCopy = computed<string>(() => {
  const code = engineState.value.code;
  switch (code) {
    case 'NO_API_KEY':
      return 'No OpenRouter API key configured. Add one in Settings.';
    case 'NO_DEFAULT_MODEL':
      return 'No default model selected. Choose one in Settings.';
    case 'NO_DOC':
      return 'No CV or job available to tailor — make sure a CV is uploaded and the job is selected.';
    case 'MODEL_NOT_CAPABLE':
      return 'The selected model cannot return structured output. Choose another model in Settings.';
    case 'RATE_LIMITED':
      return 'Rate-limited by OpenRouter — try again in a moment.';
    case 'NETWORK':
      return 'Network error reaching OpenRouter. Check your connection and try again.';
    case 'SCHEMA_ERROR':
    case 'LLM_ERROR':
      return engineState.value.message ?? 'The model returned an unexpected response.';
    default:
      return engineState.value.message ?? 'Tailor engine failed.';
  }
});
const canRetryEngine = computed<boolean>(() => {
  const code = engineState.value.code;
  return code === 'RATE_LIMITED' || code === 'NETWORK' || code === 'LLM_ERROR';
});

async function onApplyAccepted(): Promise<void> {
  if (!sourceId.value || !proposal.value) return;
  const all = proposal.value.proposedChanges;
  const accepted = [] as typeof all;
  for (let i = 0; i < all.length; i += 1) {
    if (acceptedChangeIds.value.has(i) && all[i]) accepted.push(all[i]!);
  }
  if (!accepted.length) return;
  const verifiedSkills = proposal.value.skillVerdicts
    .filter((v) => v.accepted)
    .map((v) => v.skill);
  isApplying.value = true;
  try {
    await store.applyTailorEngine({
      sourceId: sourceId.value,
      accepted,
      ...(verifiedSkills.length ? { verifiedSkills } : {}),
    });
  } finally {
    isApplying.value = false;
  }
}

async function onAccept(suggestionId: string): Promise<void> {
  if (!sourceId.value) return;
  acceptingId.value = suggestionId;
  try {
    await store.acceptTailoredSuggestion({
      sourceId: sourceId.value,
      kind: kind.value,
      suggestionId,
    });
  } finally {
    acceptingId.value = null;
  }
}

function onDismiss(suggestionId: string): void {
  if (!doc.value || !sourceId.value) return;
  // Dismiss is purely renderer-side: drop the suggestion from the cached
  // draft so it disappears from the dock without touching persistence or
  // triggering a rescore (FR-012 — accept is the only path that mutates
  // the draft + recomputes the score).
  const next = {
    ...doc.value,
    suggestions: doc.value.suggestions.filter((s) => s.id !== suggestionId),
  };
  store.tailoredDocs[`${sourceId.value}::${kind.value}`] = next;
}

async function copy(): Promise<void> {
  if (!doc.value) return;
  try {
    await navigator.clipboard?.writeText(doc.value.content);
  } catch {
    /* best-effort */
  }
}

/**
 * Plain-text export (TAILOR-007 / AC5 / FR-015) — reads the in-renderer
 * edited content directly so the file matches exactly what's on screen.
 * No round-trip through main, no submission path; the user copies / saves
 * the resulting .txt and pastes it wherever they need to.
 */
function onExportText(): void {
  if (!doc.value) return;
  const fname = jobCompany.value
    ? `cover-letter-${jobCompany.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
    : 'cover-letter.txt';
  const blob = new Blob([doc.value.content ?? ''], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
}

async function onExport(): Promise<void> {
  if (!sourceId.value) return;
  const result = await store.exportTailoredDoc({
    sourceId: sourceId.value,
    kind: kind.value,
  });
  if (!result?.ok) return;
  const blob = new Blob([result.content], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF export wiring (PDFEX-005 / Epic 8 §6).
 *
 * Letter is the default for en-US locales (US Letter is the practical
 * default page size in the United States); every other locale defaults to
 * A4. The user can flip this per export with the Letter/A4 toggle in the
 * bar (AC3).
 */
type PdfPageSize = 'letter' | 'a4';

function defaultPageSizeForLocale(): PdfPageSize {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || '';
  return lang.toLowerCase().startsWith('en-us') ? 'letter' : 'a4';
}

const pdfPageSize = ref<PdfPageSize>(defaultPageSizeForLocale());

const pdfExportState = computed(() =>
  sourceId.value
    ? store.pdfExportStateFor(sourceId.value)
    : { status: 'idle' as const, code: null, message: null },
);

const isExportingPdf = computed<boolean>(
  () => pdfExportState.value.status === 'loading',
);

const lastPdfRecord = computed(() =>
  sourceId.value ? store.pdfExportRecordFor(sourceId.value) : null,
);

const pdfErrorCopy = computed<string>(() => {
  const code = pdfExportState.value.code;
  switch (code) {
    case 'NO_DOC':
      return 'No tailored draft to export — generate one first.';
    case 'TOOLCHAIN_MISSING':
      return 'The bundled LaTeX engine was not found. Reinstall the app to restore PDF export.';
    case 'COMPILE_ERROR':
      return pdfExportState.value.message
        ? `PDF compile failed: ${pdfExportState.value.message}`
        : 'PDF compile failed. Check the draft for unsupported characters and try again.';
    case 'IO_ERROR':
      return pdfExportState.value.message ?? 'Could not write the PDF to disk.';
    default:
      return pdfExportState.value.message ?? 'PDF export failed.';
  }
});

function formatExportDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

async function onExportPdf(): Promise<void> {
  if (!sourceId.value || !doc.value) return;
  const result = await store.exportPdf({
    sourceId: sourceId.value,
    pageSize: pdfPageSize.value,
  });
  if (!result) return;
  if (result.ok) {
    const savedPath = result.record.savedPath;
    $q.notify({
      type: 'positive',
      message: 'PDF exported',
      caption: savedPath,
      timeout: 6000,
      actions: [
        {
          label: 'Reveal in folder',
          color: 'white',
          handler: () => {
            void store.revealPdfExport(savedPath);
          },
        },
      ],
    });
  }
}

async function onRevealLastPdf(): Promise<void> {
  const rec = lastPdfRecord.value;
  if (!rec) return;
  await store.revealPdfExport(rec.savedPath);
}

let unsubscribeEngineProgress: (() => void) | null = null;

onMounted(async () => {
  // TDE-007 AC4: subscribe to the per-node progress stream so the CV tab
  // can render the current LangGraph phase while the engine runs.
  unsubscribeEngineProgress = store.subscribeTailorEngineProgress();
  if (!sourceId.value) return;
  await store.hydrateApiKeyStatus();
  await store.hydratePreferredModels();
  await store.listCvs();
  // Hydrate any previously-cached draft for either kind so the tab switch
  // is instant and the stale banner reflects truth.
  await store.getTailoredDoc({ sourceId: sourceId.value, kind: 'cv' });
  await store.getTailoredDoc({ sourceId: sourceId.value, kind: 'cover-letter' });
  await store.getScore(sourceId.value);
});

onBeforeUnmount(() => {
  if (unsubscribeEngineProgress) {
    unsubscribeEngineProgress();
    unsubscribeEngineProgress = null;
  }
});
</script>

<style scoped lang="scss">
.tailor { height: 100%; display: flex; flex-direction: column; }

.bar {
  min-height: 58px; flex-shrink: 0; border-bottom: 1px solid var(--hair);
  display: flex; align-items: center; gap: 16px; padding: 10px 24px; background: var(--rail);
  &__back { color: var(--text-2); border: 1px solid var(--border-strong); border-radius: 8px; height: 32px; gap: 6px; }
  &__right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
}
.segmented { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; }
.seg { background: transparent; border: 0; padding: 6px 12px; font-size: 12.5px; color: var(--text-2); cursor: pointer; }
.seg.is-active { background: var(--accent-tint); color: var(--accent-hover); font-weight: 600; }
.intensity .seg { font-size: 11.5px; padding: 4px 10px; }

.meter { display: flex; align-items: center; gap: 8px; }
.meter__label { font-size: 11px; color: var(--muted); }
.meter__to { font-size: 14px; font-weight: 600; color: var(--olive-text); }

.banner {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 24px; font-size: 12.5px; border-bottom: 1px solid var(--hair);
  &__text { flex: 1; }
  &--stale { background: var(--olive-tint); color: var(--olive-text); }
  &--error { background: #f7e9e4; color: var(--accent-hover); }
}

.tailor__body { flex: 1; display: flex; min-height: 0; }
.canvas { flex: 1; padding: 26px 30px; display: flex; justify-content: center; background: var(--canvas); }

.loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 60px; }
.loading__text { font-size: 13px; color: var(--muted); }

.empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 60px; text-align: center; }
.empty__title { font-size: 20px; color: var(--text-3); }
.empty__sub { font-size: 13px; color: var(--muted); margin: 0; }

.paper {
  width: 100%; max-width: 880px; height: fit-content;
  background: #fff; border: 1px solid #e6e1d4; border-radius: 6px;
  box-shadow: 0 8px 24px -16px rgba(40, 36, 30, 0.3);
  padding: 28px 32px;
}

.provenance {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px;
  padding-bottom: 12px; border-bottom: 1px solid var(--hair);
  &__tag { font: 600 10px/1 var(--font-mono); padding: 3px 7px; border-radius: 5px;
    background: var(--accent-tint); color: var(--accent-hover); text-transform: uppercase; letter-spacing: .05em; }
  &__meta { font: 500 11.5px/1 var(--font-mono); color: var(--muted); }
}

.cv__columns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.cv__column { display: flex; flex-direction: column; gap: 8px; }
.cv__col-head { font: 700 10px/1 var(--font-mono); letter-spacing: .14em; color: var(--muted); text-transform: uppercase; }
.cv__text { font-size: 12.5px; line-height: 1.55; color: #3a3733; white-space: pre-wrap; word-break: break-word; }
pre.cv__text { font-family: inherit; margin: 0; }

.diff { padding: 0 1px; border-radius: 2px; }
.diff-add { background: var(--olive-tint); color: var(--olive-text); border-bottom: 1.5px solid var(--olive-text); }
.diff-del { background: #f3e0d8; color: #9a5a26; text-decoration: line-through; }
.diff-same { background: transparent; }

.letter { font-size: 13px; line-height: 1.75; color: #3a3733; padding: 28px 32px; }
.letter__body { font-family: inherit; white-space: pre-wrap; margin: 0; }
.letter__to {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 14px;
  padding-bottom: 10px; border-bottom: 1px solid var(--hair);
}
.letter__to-label { font-size: 11px; color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
.letter__to-title { font-size: 14px; font-weight: 700; color: var(--text-2); }
.letter__to-sep { color: var(--muted); }
.letter__to-company { font-size: 13.5px; font-weight: 600; color: var(--olive-text); }
.letter__editor {
  width: 100%; min-height: 320px; resize: vertical;
  font: inherit; line-height: 1.7; color: #3a3733;
  background: #fff; border: 1px solid var(--hair); border-radius: 6px;
  padding: 14px 16px; outline: none;
  &:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
}

.gaps {
  margin-top: 20px; border-top: 1px solid var(--hair); padding-top: 14px;
  display: flex; flex-direction: column; gap: 10px;
  &__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  &__title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-2); }
  &__sub { font-size: 11.5px; color: var(--muted); }
  &__hint { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  &__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  &__item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
    border: 1px solid var(--hair); border-radius: 8px; background: var(--rail); }
  &__category { font-size: 10.5px; letter-spacing: .08em; color: var(--accent-hover);
    background: var(--accent-tint); padding: 3px 7px; border-radius: 5px; align-self: flex-start;
    text-transform: uppercase; }
  &__text { margin: 0; font-size: 12.5px; color: #3a3733; line-height: 1.5; }
  &__actions { display: flex; gap: 7px; }
  &__empty { font-size: 12px; color: var(--muted); padding: 8px 4px; }
}

.dock {
  width: 340px; flex-shrink: 0; border-left: 1px solid var(--hair); background: var(--rail);
  &__head { display: flex; align-items: center; gap: 7px; padding: 18px 18px 6px; }
  &__badge { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; }
  &__title { margin: 0; font-size: 13.5px; font-weight: 700; }
  &__left { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--accent-tint); color: var(--accent-hover); padding: 4px 7px; border-radius: 6px; }
  &__lead { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.45; padding: 0 18px 14px; border-bottom: 1px solid var(--hair); }
  &__empty { padding: 18px; font-size: 12px; color: var(--muted); text-align: center; }
}
.cards { padding: 14px; display: flex; flex-direction: column; gap: 11px; }
.card { border: 1px solid var(--hair); background: #fff; border-radius: 11px; padding: 13px; }
.card__head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.card__rationale { margin: 0 0 10px; font-size: 11.5px; color: var(--muted); line-height: 1.4; }
.tag { font: 600 10px/1 var(--font-mono); padding: 3px 7px; border-radius: 5px; text-transform: uppercase; letter-spacing: .05em; }
.tag--accent { background: var(--accent-tint); color: var(--accent-hover); }
.gain { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--olive-text); }
.card__text { margin: 0 0 11px; font-size: 12.5px; line-height: 1.5; color: #3a3733; }
.card__actions { display: flex; gap: 7px; }
.col-grow { flex: 1; }
.ghost { color: var(--muted); border-color: var(--input-border); }

.ats {
  border-top: 1px solid var(--hair); padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 8px;
  &__head { display: flex; align-items: center; gap: 8px; }
  &__title { margin: 0; font-size: 13px; font-weight: 700; }
  &__score { margin-left: auto; font-size: 12px; color: var(--olive-text); background: var(--olive-tint); padding: 3px 7px; border-radius: 5px; }
  &__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  &__item--pass { color: var(--text-2); }
  &__item--fail { color: var(--accent-hover); font-weight: 600; }
  &__mark { display: inline-block; width: 14px; }
  &__rule { font-size: 12px; }
  &__detail { display: block; padding-left: 14px; font-size: 11.5px; color: var(--muted); font-weight: 400; }
  &__missing { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  &__missing-label { font: 700 10px/1 var(--font-mono); letter-spacing: .12em; color: var(--muted); text-transform: uppercase; margin-right: 4px; }
}
.skill { font-size: 11px; padding: 4px 9px; border-radius: 6px; }
.skill--hl { background: var(--accent-hl); color: #9a5a26; border: 1px solid #e6c4a8; }
</style>
