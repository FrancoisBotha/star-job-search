<template>
  <q-dialog v-model="open" :maximized="false">
    <div class="jdd app-scroll">
      <header class="jdd__head">
        <div class="jdd__head-meta">
          <div class="font-serif jdd__title">{{ job.title || job.url }}</div>
          <div class="jdd__sub">
            <span v-if="job.company">{{ job.company }}</span>
            <span v-if="job.company && job.location" class="jdd__sep">·</span>
            <span v-if="job.location">{{ job.location }}</span>
          </div>
        </div>
        <q-btn
          v-close-popup
          flat
          dense
          round
          icon="close"
          class="jdd__close"
          aria-label="Close"
        />
      </header>

      <dl class="jdd__chips">
        <div v-if="workMode" class="jdd__chip">
          <dt>Work mode</dt>
          <dd>{{ workMode }}</dd>
        </div>
        <div class="jdd__chip">
          <dt>Salary</dt>
          <dd>{{ salaryLabel }}</dd>
        </div>
      </dl>

      <section v-if="score" class="jdd__section jdd__score">
        <div class="jdd__score-head">
          <div class="font-serif jdd__score-stars-num">{{ score.stars.toFixed(1) }}</div>
          <div>
            <StarRating :score="score.stars" :size="17" :gap="3" />
            <div class="font-mono jdd__score-fit">{{ Math.round(score.percent) }}% profile fit</div>
          </div>
        </div>

        <h3 class="jdd__h3">Score breakdown</h3>
        <ul class="jdd__factors">
          <li v-for="f in score.factors" :key="f.key" class="jdd__factor">
            <div class="jdd__factor-head">
              <span class="jdd__factor-label">{{ factorLabel(f.key) }}</span>
              <span
                v-if="!f.included"
                class="jdd__factor-excluded"
                aria-label="excluded"
              >excluded</span>
              <span v-else class="jdd__factor-included" aria-label="included">included</span>
            </div>
            <ScoreBar
              v-if="f.included"
              :label="''"
              :value="Math.round(f.score)"
              :good="f.score >= 50"
            />
            <p class="jdd__factor-rationale">{{ f.rationale }}</p>
          </li>
        </ul>
      </section>

      <section
        ref="reviewSection"
        class="jdd__section jdd__review"
        aria-labelledby="jdd-review-heading"
      >
        <header class="jdd__review-head">
          <h3 id="jdd-review-heading" class="jdd__h3 jdd__review-h3">
            AI Match Review
          </h3>
          <span class="jdd__review-badge" aria-label="AI advisory">AI</span>
          <span class="jdd__review-advisory">advisory</span>
        </header>
        <p class="jdd__review-disclaimer">
          A qualitative read of this job against your CV &amp; Profile. The
          deterministic stars above remain the authoritative rating; this AI
          review never contributes a score.
        </p>

        <!-- Empty state — no cached review and not loading -->
        <template v-if="!review && reviewState.status !== 'loading' && reviewState.status !== 'error'">
          <p class="jdd__review-empty">
            No review yet for this job.
          </p>
          <q-btn
            no-caps
            unelevated
            color="primary"
            label="Generate review"
            class="jdd__review-btn"
            :disable="!canGenerateReview"
            @click="onGenerateReview"
          />
          <p v-if="!canGenerateReview" class="jdd__review-hint">
            Add an OpenRouter API key and select a default model in Settings,
            and upload a CV on your Profile, to enable AI Match Review.
          </p>
        </template>

        <!-- One-time disclosure (Epic 4 reuse) before the first send -->
        <div v-if="showReviewDisclosure" class="jdd__review-disclosure" role="dialog" aria-label="What is sent">
          <h4 class="jdd__review-disclosure-h4">What is sent</h4>
          <p>
            Your CV text and this job's description are sent to your selected
            OpenRouter model to produce the review. No other data leaves your
            machine.
          </p>
          <div class="jdd__review-disclosure-actions">
            <q-btn
              no-caps
              flat
              dense
              label="Cancel"
              @click="showReviewDisclosure = false"
            />
            <q-btn
              no-caps
              unelevated
              color="primary"
              label="Acknowledge &amp; generate"
              @click="onAcknowledgeAndGenerate"
            />
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="reviewState.status === 'loading'" class="jdd__review-loading">
          <q-spinner color="primary" size="20px" />
          <span>Generating review&hellip;</span>
        </div>

        <!-- Per-code error states -->
        <div
          v-if="reviewState.status === 'error' && reviewState.code"
          class="jdd__review-error"
          role="alert"
        >
          <p class="jdd__review-error-msg">{{ reviewErrorMessage }}</p>
          <p class="jdd__review-error-code">
            <span class="font-mono">{{ reviewState.code }}</span>
          </p>
          <q-btn
            no-caps
            outline
            color="primary"
            label="Try again"
            @click="onGenerateReview"
          />
        </div>

        <!-- Generated narrative -->
        <template v-if="review">
          <p class="jdd__review-provenance font-mono">
            AI review · {{ review.modelSlug || 'unknown model' }} ·
            {{ formatReviewDate(review.generatedAt) }}
          </p>

          <p v-if="review.stale" class="jdd__review-stale">
            may be out of date — regenerate
          </p>

          <div class="jdd__review-actions">
            <q-btn
              no-caps
              outline
              dense
              color="primary"
              label="Regenerate"
              :disable="reviewState.status === 'loading'"
              @click="onGenerateReview"
            />
          </div>

          <p class="jdd__review-summary">{{ review.summary }}</p>

          <h4 class="jdd__review-h4">Requirements</h4>
          <ul class="jdd__review-list">
            <li
              v-for="(req, ri) in review.requirements"
              :key="`req-${ri}`"
              class="jdd__review-item"
            >
              <div class="jdd__review-row">
                <span class="jdd__review-req">{{ req.requirement }}</span>
                <span
                  v-if="req.met"
                  class="jdd__review-met"
                  aria-label="met"
                >met</span>
                <span
                  v-else
                  class="jdd__review-notfound"
                  aria-label="not found"
                >not found</span>
              </div>
              <p
                v-if="req.evidence"
                class="jdd__review-evidence"
              >Evidence: {{ req.evidence }}</p>
            </li>
          </ul>

          <h4 v-if="review.gaps.length" class="jdd__review-h4">Gaps</h4>
          <ul v-if="review.gaps.length" class="jdd__review-list">
            <li
              v-for="(gap, gi) in review.gaps"
              :key="`gap-${gi}`"
              class="jdd__review-item"
            >
              <div class="jdd__review-row">
                <span class="jdd__review-gap-text">{{ gap.text }}</span>
                <span
                  v-if="gap.severity === 'blocker'"
                  class="jdd__review-blocker"
                  aria-label="blocker"
                >blocker</span>
                <span
                  v-else
                  class="jdd__review-nice"
                  aria-label="nice to have"
                >nice-to-have</span>
              </div>
              <p class="jdd__review-mitigation">Mitigation: {{ gap.mitigation }}</p>
            </li>
          </ul>

          <h4 v-if="review.strengths.length" class="jdd__review-h4">Strengths</h4>
          <ul v-if="review.strengths.length" class="jdd__review-bullets">
            <li
              v-for="(s, si) in review.strengths"
              :key="`str-${si}`"
            >{{ s }}</li>
          </ul>

          <h4 v-if="review.keywords.length" class="jdd__review-h4">Keywords to mirror</h4>
          <ul v-if="review.keywords.length" class="jdd__review-keywords">
            <li
              v-for="(k, ki) in review.keywords"
              :key="`kw-${ki}`"
              class="jdd__review-kw font-mono"
            >{{ k }}</li>
          </ul>
        </template>
      </section>

      <section class="jdd__section">
        <h3 class="jdd__h3">Description</h3>
        <p class="jdd__desc">{{ job.description || 'No description available.' }}</p>
      </section>

      <section class="jdd__section">
        <h3 class="jdd__h3">Source{{ sources.length > 1 ? 's' : '' }}</h3>
        <ul class="jdd__sources">
          <li v-for="s in sources" :key="s.url" class="jdd__source">
            <a
              class="jdd__link"
              href="#"
              @click.prevent="openSource(s.url)"
            >{{ s.hostname }}</a>
          </li>
        </ul>
      </section>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import type { MatchReview, MatchReviewGenerateState } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import ScoreBar from 'src/components/ScoreBar.vue';
import type { FactorKey, JobRecord, MatchScore } from 'src/types/models';
import { formatSalary } from 'src/utils/salary';

/**
 * Extended view of a JobRecord — the renderer-side mirror in
 * `src/types/models.ts` carries only the fields the main-process extractor
 * already persists. The Job Detail dialog also surfaces work mode, salary,
 * and per-board source links when the upstream record provides them. Those
 * extras are typed here as optional so the dialog renders gracefully when
 * they are absent (Scenario 4 / AC2).
 */
export interface JobDetailJob extends JobRecord {
  workMode?: string | null;
  salary?: string | null;
  sources?: Array<{ hostname: string; url: string }> | null;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    job: JobDetailJob;
    /**
     * AIREV-009 — when true, the dialog scrolls the AI Match Review
     * section into view on open and, if no review is cached and the user
     * has the prerequisites (key + default model + CV), kicks off the
     * on-demand generate so the user lands on a generating/ready report
     * instead of an empty section. Defaults to false so the existing
     * Detail-button flow is unchanged.
     */
    focusReview?: boolean;
  }>(),
  { focusReview: false },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const store = useAppStore();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const workMode = computed(() => props.job.workMode || '');

const salaryLabel = computed(() => formatSalary(props.job.salary));

const sources = computed(() => {
  const list = props.job.sources;
  if (Array.isArray(list) && list.length > 0) return list;
  return [{ hostname: props.job.hostname, url: props.job.url }];
});

/**
 * The persisted MatchScore for this listing, read from the app-store by
 * `sourceId`. Returning the same MatchScore object whose `factors` the UI
 * renders is what guarantees NFR-003: the displayed stars + percent and
 * the factor breakdown come from one source of truth and reconcile by
 * construction.
 */
const score = computed<MatchScore | null>(
  () => store.scores[props.job.sourceId] ?? null,
);

const FACTOR_LABELS: Record<FactorKey, string> = {
  skills: 'Skills',
  experience: 'Experience',
  location: 'Location',
  salary: 'Salary',
};

function factorLabel(key: FactorKey): string {
  return FACTOR_LABELS[key] ?? key;
}

function openSource(url: string) {
  void store.openExternal(url);
}

/**
 * Cached AI Match Review for this job (AIREV-005 / Epic 6 §6). Narrative
 * only — by hard boundary the [[MatchReview]] shape carries no score, star,
 * or percent field. The deterministic Epic 5 score block above remains the
 * sole authoritative rating in this dialog (NFR-001).
 */
const review = computed<MatchReview | null>(
  () => store.reviews[props.job.sourceId] ?? null,
);

const IDLE_REVIEW_STATE: MatchReviewGenerateState = {
  status: 'idle',
  code: null,
  message: null,
};

const reviewState = computed<MatchReviewGenerateState>(
  () => store.reviewStates[props.job.sourceId] ?? IDLE_REVIEW_STATE,
);

/**
 * Local "show the Epic 4 disclosure inline" flag. Flips on when the user
 * clicks Generate before the one-time "what is sent" acknowledgement has
 * been recorded (reused from Onboarding's CV review flow / FR-005). Once
 * acknowledged, [[reviewDisclosureAcknowledged]] persists in localStorage
 * and the gate is permanently lifted.
 */
const showReviewDisclosure = ref(false);

/**
 * True when the user has the prerequisites to generate a review — saved
 * OpenRouter API key + a default model selected + an uploaded CV. When any
 * of these is missing the Generate button is disabled and the hint copy
 * directs the user to the matching settings (FR-001).
 */
const canGenerateReview = computed(() =>
  Boolean(
    store.apiKeyStatus.present &&
    store.preferredModels.some((m) => m.isDefault) &&
    store.currentCv,
  ),
);

const ERROR_MESSAGES: Record<string, string> = {
  NO_API_KEY:
    'No OpenRouter API key saved. Add one in Settings to enable AI Match Review.',
  NO_DEFAULT_MODEL:
    'No default model selected. Pick a preferred model in Settings.',
  NO_CV:
    'No CV on file. Upload a CV on the Profile screen first.',
  JOB_NOT_FOUND:
    'This job is no longer available — try re-extracting from the source site.',
  MODEL_NOT_CAPABLE:
    'Your selected model does not support structured output. Choose a function-calling–capable model in Settings.',
  RATE_LIMITED:
    'Rate-limited by OpenRouter. Wait a moment, then try again.',
  LLM_ERROR:
    'The model call failed. Check your connection and try again.',
  SCHEMA_ERROR:
    'The model returned an unexpected shape. Try regenerating.',
};

const reviewErrorMessage = computed(() => {
  const code = reviewState.value.code;
  if (!code) return '';
  // Surface a rate-limit-specific message when the underlying message
  // string carries the upstream rate-limit signal (LLM_ERROR is the catch-all
  // code; the message text disambiguates rate-limited from generic failures).
  const msg = reviewState.value.message || '';
  if (code === 'LLM_ERROR' && /rate[- ]?limit/i.test(msg)) {
    return ERROR_MESSAGES.RATE_LIMITED ?? msg;
  }
  return ERROR_MESSAGES[code] ?? msg ?? 'Review failed.';
});

function formatReviewDate(ts: number | undefined): string {
  if (!ts) return 'unknown date';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'unknown date';
  }
}

/**
 * Click handler for the Generate / Regenerate / Try again controls. Surfaces
 * the Epic 4 "what is sent" disclosure inline before the first send;
 * subsequent sends bypass it because [[reviewDisclosureAcknowledged]] is
 * persisted in localStorage and survives a restart.
 */
function onGenerateReview() {
  if (!store.reviewDisclosureAcknowledged) {
    store.hydrateReviewDisclosure();
  }
  if (!store.reviewDisclosureAcknowledged) {
    showReviewDisclosure.value = true;
    return;
  }
  void store.generateReview(props.job.sourceId);
}

function onAcknowledgeAndGenerate() {
  store.acknowledgeReviewDisclosure();
  showReviewDisclosure.value = false;
  void store.generateReview(props.job.sourceId);
}

/**
 * When the dialog opens, lazy-hydrate the cached review (if any) so the
 * narrative renders immediately on subsequent opens without forcing the user
 * to regenerate. Also pulls the persisted disclosure ack so the Generate
 * gate is correct on the very first click.
 */
const reviewSection = ref<HTMLElement | null>(null);

/**
 * AIREV-009 — bring the AI Match Review section into view and, when the
 * dialog was opened via the board's AI button with no cached review and
 * the user has the prerequisites, trigger the on-demand generate path so
 * the user lands on a generating/ready report rather than an empty
 * section. Degrades gracefully when no key/model/CV is present: the
 * existing disabled Generate state and "needs key" hint render unchanged.
 */
async function maybeFocusReview() {
  if (!props.modelValue || !props.focusReview) return;
  await nextTick();
  const el = reviewSection.value;
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (
    !store.reviews[props.job.sourceId] &&
    canGenerateReview.value &&
    reviewState.value.status !== 'loading'
  ) {
    onGenerateReview();
  }
}

function maybeHydrate() {
  if (!props.modelValue) return;
  if (!store.reviewDisclosureAcknowledged) store.hydrateReviewDisclosure();
  if (!store.reviews[props.job.sourceId]) {
    void store.getReview(props.job.sourceId);
  }
  void maybeFocusReview();
}

onMounted(maybeHydrate);
watch(
  () => [props.modelValue, props.job.sourceId, props.focusReview] as const,
  () => maybeHydrate(),
);
</script>

<style scoped lang="scss">
.jdd {
  background: var(--card);
  border-radius: 14px;
  padding: 26px 28px 28px;
  width: min(720px, 92vw);
  max-height: 86vh;
  overflow: auto;

  &__head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 18px;
  }
  &__head-meta { flex: 1; min-width: 0; }
  &__title {
    font-size: 22px;
    line-height: 1.25;
    font-weight: 700;
  }
  &__sub {
    font-size: 13px;
    color: var(--text-3);
    margin-top: 4px;
  }
  &__sep { margin: 0 6px; }
  &__close { color: var(--muted); }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 18px;
    padding: 0;
  }
  &__chip {
    background: var(--olive-tint);
    color: var(--olive-text);
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 12px/1.2 var(--font-mono);
    dt {
      display: inline;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 10.5px;
      opacity: 0.75;
      margin-right: 6px;
    }
    dd {
      display: inline;
      margin: 0;
    }
  }

  &__section { margin-top: 16px; }
  &__h3 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
    margin: 0 0 8px;
  }
  &__desc {
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.55;
    margin: 0;
  }

  &__score-head {
    display: flex;
    align-items: flex-end;
    gap: 13px;
    margin-bottom: 16px;
  }
  &__score-stars-num { font-size: 38px; line-height: 0.85; }
  &__score-fit {
    font-size: 12px;
    font-weight: 600;
    color: var(--olive-text);
    margin-top: 6px;
  }

  &__factors {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  &__factor { display: flex; flex-direction: column; gap: 4px; }
  &__factor-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-2);
  }
  &__factor-label { font-weight: 600; }
  &__factor-excluded {
    font: 500 11px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  &__factor-included {
    font: 500 11px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--olive-text);
  }
  &__factor-rationale {
    margin: 2px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-2);
  }

  &__review {
    border: 1px dashed var(--muted);
    border-radius: 10px;
    padding: 14px 16px;
    background: var(--card);
  }
  &__review-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  &__review-h3 { margin: 0; }
  &__review-badge {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.06em;
    padding: 4px 6px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  &__review-advisory {
    font: 500 11px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  &__review-disclaimer {
    margin: 4px 0 12px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-3);
  }
  &__review-empty {
    font-size: 13px;
    color: var(--text-2);
    margin: 6px 0 10px;
  }
  &__review-btn { margin-top: 4px; }
  &__review-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  &__review-disclosure {
    margin: 10px 0;
    padding: 12px;
    border: 1px solid var(--muted);
    border-radius: 8px;
    background: var(--olive-tint);
  }
  &__review-disclosure-h4 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
  }
  &__review-disclosure-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    justify-content: flex-end;
  }
  &__review-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    font-size: 13px;
    color: var(--text-2);
  }
  &__review-error {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid #c33;
    border-radius: 8px;
    background: #fff5f5;
    color: #7a1f1f;
  }
  &__review-error-msg { margin: 0 0 4px; font-size: 13px; }
  &__review-error-code {
    margin: 0 0 8px;
    font-size: 11px;
    opacity: 0.75;
  }
  &__review-provenance {
    font-size: 11px;
    color: var(--muted);
    margin: 0 0 4px;
  }
  &__review-stale {
    font-size: 12px;
    color: #8a5a00;
    background: #fff7e0;
    border-left: 3px solid #d4a017;
    padding: 6px 8px;
    margin: 4px 0 8px;
  }
  &__review-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  &__review-summary {
    margin: 0 0 12px;
    font-size: 14px;
    line-height: 1.5;
    font-style: italic;
  }
  &__review-h4 {
    margin: 12px 0 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
  }
  &__review-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  &__review-item {
    border-left: 2px solid var(--muted);
    padding-left: 10px;
  }
  &__review-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  &__review-req,
  &__review-gap-text {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }
  &__review-met,
  &__review-notfound,
  &__review-blocker,
  &__review-nice {
    font: 500 10.5px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 5px;
    border-radius: 4px;
  }
  &__review-met { color: var(--olive-text); background: var(--olive-tint); }
  &__review-notfound { color: var(--muted); background: transparent; border: 1px solid var(--muted); }
  &__review-blocker { color: #fff; background: #c33; }
  &__review-nice { color: var(--muted); background: transparent; border: 1px solid var(--muted); }
  &__review-evidence,
  &__review-mitigation {
    margin: 4px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-2);
  }
  &__review-bullets {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.5;
  }
  &__review-keywords {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  &__review-kw {
    background: var(--olive-tint);
    color: var(--olive-text);
    padding: 3px 7px;
    border-radius: 4px;
    font-size: 11.5px;
  }

  &__sources { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  &__source { font-size: 13px; }
  &__link {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
    &:hover { opacity: 0.85; }
  }
}
</style>
