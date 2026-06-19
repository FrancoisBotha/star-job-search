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
      </div>
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

    <div class="tailor__body">
      <!-- document canvas -->
      <div class="canvas app-scroll">
        <!-- Generating spinner (FR-014). -->
        <div v-if="isGenerating && !doc" class="loading">
          <q-spinner color="primary" size="32px" />
          <p class="loading__text">Generating tailored draft…</p>
        </div>

        <!-- Empty / not-yet-generated state. -->
        <div v-else-if="!doc" class="empty">
          <div class="font-serif empty__title">No draft yet</div>
          <p class="empty__sub">Generate a tailored {{ kind === 'cv' ? 'CV' : 'cover letter' }} for this job.</p>
          <q-btn unelevated color="primary" no-caps label="Generate" :disable="!tailoringAvailable" @click="onGenerate" />
        </div>

        <!-- CV view: base vs tailored with diff highlighting (FR-003). -->
        <div v-else-if="kind === 'cv'" class="paper paper--diff">
          <div class="provenance" data-test="provenance">
            <span class="provenance__tag">AI draft · advisory</span>
            <span class="provenance__meta">{{ provenanceLabel }}</span>
            <span v-if="store.currentCv" class="provenance__meta">built from CV v{{ store.currentCv.version }}</span>
          </div>

          <div class="cv__columns">
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
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import type { TailoredDocKind } from 'src/stores/app-store';

type StarTailorIntensity = 'light' | 'aggressive';

const router = useRouter();
const route = useRoute();
const store = useAppStore();

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
  void store.generateTailoredDoc({
    sourceId: sourceId.value,
    kind: kind.value,
    intensity: intensity.value,
  });
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

onMounted(async () => {
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
