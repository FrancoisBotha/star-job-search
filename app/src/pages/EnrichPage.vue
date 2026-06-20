<template>
  <div class="enrich app-scroll">
    <div class="bar">
      <div class="bar__title font-serif">CV Enrichment</div>
      <div class="bar__sub">
        Strengthen weak bullets with grounded metrics — no invented numbers.
      </div>
    </div>

    <!-- Stepper (AC2/AC3/AC4 — visible across the flow) -->
    <ol class="stepper" data-test="enrich-stepper" aria-label="Enrichment steps">
      <li class="step" :class="{ 'is-active': stepIndex >= 0, 'is-done': stepIndex > 0 }">
        <span class="step__n font-mono">1</span><span class="step__l">Analyze</span>
      </li>
      <li class="step" :class="{ 'is-active': stepIndex >= 1, 'is-done': stepIndex > 1 }">
        <span class="step__n font-mono">2</span><span class="step__l">Questions</span>
      </li>
      <li class="step" :class="{ 'is-active': stepIndex >= 2, 'is-done': stepIndex > 2 }">
        <span class="step__n font-mono">3</span><span class="step__l">Review</span>
      </li>
    </ol>

    <!-- AC5 — disabled states ----------------------------------------- -->
    <div
      v-if="!hasCv"
      class="state state--disabled"
      data-test="enrich-no-cv"
    >
      <div class="state__title font-serif">No CV uploaded yet</div>
      <p class="state__msg">
        Upload a CV under <strong>Profile → CV</strong> before enriching.
        Enrichment is disabled until a base CV exists.
      </p>
      <q-btn unelevated color="primary" no-caps label="Go to Profile" @click="goProfile" />
    </div>

    <div
      v-else-if="!hasKey"
      class="state state--disabled"
      data-test="enrich-no-key"
    >
      <div class="state__title font-serif">Feature disabled — no OpenRouter API key</div>
      <p class="state__msg">
        CV Enrichment uses your configured model via OpenRouter. Add an API key
        and pick a default model in Settings to enable the feature.
      </p>
      <q-btn unelevated color="primary" no-caps label="Open Settings" @click="goSettings" />
    </div>

    <template v-else>
      <!-- AC6 — error banner (code-driven copy across all four steps) -->
      <div
        v-if="store.enrichError"
        class="state state--error"
        data-test="enrich-error"
        role="alert"
      >
        <p class="state__msg">{{ errorCopy }}</p>
        <p class="state__code"><span class="font-mono">{{ store.enrichError.code }}</span></p>
        <q-btn outline no-caps color="primary" label="Try again" @click="onRetry" />
      </div>

      <!-- STEP 1 — Analyze (AC2) ------------------------------------- -->
      <section v-if="stepIndex === 0" class="step-panel" aria-label="Step 1: Analyze">
        <header class="panel__head">
          <h3 class="panel__title">Step 1 · Analyze your CV</h3>
          <p class="panel__sub">
            We scan your bullets for vague verbs, missing metrics, passive
            voice, and missing scope — then prioritise the weakest items.
          </p>
        </header>

        <div
          v-if="store.enrichStatus === 'analyzing'"
          class="loading"
          data-test="enrich-analyze-loading"
        >
          <q-spinner color="primary" size="20px" />
          <span>Analyzing your CV…</span>
        </div>

        <template v-else>
          <div v-if="!store.enrichReport" class="panel__cta">
            <q-btn
              unelevated
              color="primary"
              no-caps
              label="Analyze CV"
              data-test="enrich-analyze"
              @click="onAnalyze"
            />
          </div>

          <div v-else class="weak">
            <p class="weak__summary" data-test="enrich-weak-summary">
              Found <strong>{{ store.enrichReport.items.length }}</strong>
              bullet{{ store.enrichReport.items.length === 1 ? '' : 's' }}
              that could be stronger.
            </p>

            <ul class="weak__list" data-test="enrich-weak-list">
              <li
                v-for="(item, idx) in store.enrichReport.items"
                :key="`weak-${idx}`"
                class="weak__item"
                data-test="enrich-weak-item"
              >
                <div class="weak__path font-mono">{{ item.path }}</div>
                <div class="weak__text">{{ item.text }}</div>
                <div class="weak__reason">{{ item.reason }}</div>
                <div class="weak__signals">
                  <span
                    v-for="sig in item.signals"
                    :key="sig"
                    class="signal font-mono"
                  >{{ sig }}</span>
                </div>
              </li>
              <li v-if="!store.enrichReport.items.length" class="weak__empty">
                No weak bullets detected — nothing to enrich.
              </li>
            </ul>

            <div class="panel__actions">
              <q-btn
                unelevated
                color="primary"
                no-caps
                label="Continue to questions"
                data-test="enrich-to-questions"
                :disable="!store.enrichReport.items.length"
                @click="onGenerateQuestions"
              />
            </div>
          </div>
        </template>
      </section>

      <!-- STEP 2 — Questions (AC3) ----------------------------------- -->
      <section v-else-if="stepIndex === 1" class="step-panel" aria-label="Step 2: Questions">
        <header class="panel__head">
          <h3 class="panel__title">Step 2 · Answer a few targeted questions</h3>
          <p class="panel__sub">
            We ask 2–6 questions to ground each rewrite in a real number.
            If you don't have that number, skip it — we'll <strong>minimally
            reword</strong> the bullet and <strong>never invent</strong> a
            metric.
          </p>
        </header>

        <div
          v-if="store.enrichStatus === 'questioning'"
          class="loading"
          data-test="enrich-questions-loading"
        >
          <q-spinner color="primary" size="20px" />
          <span>Building questions…</span>
        </div>

        <template v-else-if="store.enrichQuestionnaire">
          <ul class="questions">
            <li
              v-for="q in store.enrichQuestionnaire.questions"
              :key="q.id"
              class="question"
              data-test="enrich-question"
              :data-question-id="q.id"
            >
              <div class="question__kind font-mono">{{ q.kind }}</div>
              <div class="question__bullet">{{ q.bulletText }}</div>
              <p class="question__text">{{ q.question }}</p>
              <div class="question__row">
                <input
                  class="question__input"
                  type="text"
                  data-test="enrich-answer-input"
                  placeholder="e.g. 250k users, 30% reduction"
                  :value="answerValueFor(q.id)"
                  @input="onAnswerInput(q.id, $event)"
                />
                <q-btn
                  outline
                  no-caps
                  dense
                  label="I don't have that number"
                  data-test="enrich-skip"
                  @click="onSkip(q.id)"
                />
              </div>
              <div
                v-if="isSkipped(q.id)"
                class="question__hint"
                data-test="enrich-skipped-hint"
              >
                Skipped — this bullet will be minimally reworded; we won't
                invent a metric.
              </div>
            </li>
          </ul>

          <div class="panel__actions">
            <q-btn
              outline
              no-caps
              label="Back"
              @click="onBackToAnalyze"
            />
            <q-btn
              unelevated
              color="primary"
              no-caps
              label="Generate proposed rewrites"
              data-test="enrich-to-review"
              @click="onPropose"
            />
          </div>
        </template>
      </section>

      <!-- STEP 3 — Review (AC4) -------------------------------------- -->
      <section v-else class="step-panel" aria-label="Step 3: Review">
        <header class="panel__head">
          <h3 class="panel__title">Step 3 · Review proposed rewrites</h3>
          <p class="panel__sub">
            Each change is grounded in your answer (or marked as a minimal
            reword). Accept or reject per change, then Apply to write a new
            CV version.
          </p>
        </header>

        <div
          v-if="store.enrichStatus === 'proposing'"
          class="loading"
          data-test="enrich-propose-loading"
        >
          <q-spinner color="primary" size="20px" />
          <span>Generating proposed rewrites…</span>
        </div>

        <div
          v-else-if="store.enrichStatus === 'applying'"
          class="loading"
          data-test="enrich-apply-loading"
        >
          <q-spinner color="primary" size="20px" />
          <span>Applying changes and writing a new CV version…</span>
        </div>

        <div
          v-else-if="store.enrichStatus === 'applied' && store.enrichAppliedVersion !== null"
          class="state state--applied"
          data-test="enrich-applied"
        >
          <div class="state__title font-serif">
            CV updated (v{{ store.enrichAppliedVersion }})
          </div>
          <p class="state__msg">
            Your new CV version is saved. Match scores and AI reviews have
            been flagged stale so you can regenerate them.
          </p>
          <q-btn unelevated color="primary" no-caps label="Done" @click="onReset" />
        </div>

        <template v-else-if="store.enrichProposals.length">
          <section
            class="proposal"
            data-test="enrich-proposal"
            aria-label="Enrichment proposal"
          >
            <!-- Reused +/~/– marker legend from the TDE-007 CV tab (Epic 9 §8). -->
            <div class="changes__legend font-mono" aria-label="Change marker legend">
              <span>+ add</span> · <span>~ replace</span> · <span>– reorder</span>
            </div>

            <ul class="changes">
              <li
                v-for="(p, idx) in store.enrichProposals"
                :key="`prop-${idx}`"
                class="changes__item"
                :class="{ 'changes__item--accepted': store.enrichAccepted.has(idx) }"
                data-test="enrich-proposed-change"
              >
                <span class="changes__marker font-mono">{{ markerFor(p.change.action) }}</span>
                <div class="changes__body">
                  <div class="changes__path font-mono">
                    {{ p.change.path }} · {{ p.change.action }}
                  </div>
                  <div v-if="p.change.original" class="changes__before">
                    <span class="before-label font-mono">BEFORE</span>
                    <span class="before-text">{{ p.change.original }}</span>
                  </div>
                  <div class="changes__after">
                    <span class="after-label font-mono">AFTER</span>
                    <span class="after-text">{{ renderValue(p.change) }}</span>
                  </div>
                  <div class="changes__reason">{{ p.reason }}</div>
                  <div
                    class="changes__provenance"
                    data-test="enrich-provenance"
                  >
                    <span class="provenance-label font-mono">provenance</span>
                    <span class="provenance-text">{{ p.provenance }}</span>
                  </div>
                  <div
                    v-if="!p.gateVerdict.ok"
                    class="changes__gate"
                    data-test="enrich-gate-warning"
                  >
                    Blocked by safety gate: {{ p.gateVerdict.reason }}
                  </div>
                </div>
                <div class="changes__actions">
                  <q-btn
                    dense
                    unelevated
                    color="primary"
                    no-caps
                    :label="store.enrichAccepted.has(idx) ? 'Accepted' : 'Accept'"
                    data-test="enrich-change-accept"
                    @click="onAccept(idx)"
                  />
                  <q-btn
                    dense
                    outline
                    no-caps
                    label="Reject"
                    data-test="enrich-change-reject"
                    @click="onReject(idx)"
                  />
                </div>
              </li>
            </ul>

            <p v-if="!store.enrichProposals.length" class="changes__empty">
              No proposed rewrites — the gates rejected every candidate.
            </p>

            <div class="panel__actions">
              <q-btn
                outline
                no-caps
                label="Back"
                @click="onBackToQuestions"
              />
              <q-btn
                unelevated
                color="primary"
                no-caps
                label="Apply accepted changes"
                data-test="enrich-apply"
                :disable="!store.enrichAccepted.size"
                @click="onApply"
              />
            </div>
          </section>
        </template>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';

/**
 * ENRICH-006 — CV Enrichment screen (Epic 13).
 *
 * Three-step flow driven through `window.starEnrich`:
 *   Step 1 Analyze   — ENRICH-001 weak-bullet report.
 *   Step 2 Questions — ENRICH-002 metric-discovery questions (2–6, skippable).
 *   Step 3 Review    — ENRICH-003 grounded proposals shown as an Epic 9
 *                      accept/reject diff with provenance labels; Apply
 *                      writes a new CV version (ENRICH-004) and surfaces
 *                      "CV updated (v{n})".
 *
 * Disabled states are hard gates: no CV → "Upload a CV"; no key → "Feature
 * disabled". Loading + error states are rendered per async step off the
 * stable [[StarEnrichErrorCode]] union so the copy never has to parse
 * exception text.
 */

const router = useRouter();
const store = useAppStore();

const hasCv = computed<boolean>(() => Boolean(store.currentCv));
const hasKey = computed<boolean>(
  () => store.apiKeyStatus.present && store.preferredModels.some((m) => m.isDefault),
);

const stepIndex = computed<number>(() => {
  const s = store.enrichStatus;
  if (s === 'idle' || s === 'analyzing' || s === 'analyzed') return 0;
  if (s === 'questioning' || s === 'questioned') return 1;
  return 2;
});

const errorCopy = computed<string>(() => {
  const e = store.enrichError;
  if (!e) return '';
  switch (e.code) {
    case 'NO_API_KEY':
      return 'No OpenRouter API key configured. Add one in Settings.';
    case 'NO_DEFAULT_MODEL':
      return 'No default model selected. Choose one in Settings.';
    case 'NO_CV':
      return 'Upload a CV under Profile → CV before enriching.';
    case 'MODEL_NOT_CAPABLE':
      return 'The selected model cannot return structured output. Choose another model in Settings.';
    case 'RATE_LIMITED':
      return 'Rate-limited by OpenRouter — try again in a moment.';
    case 'NETWORK':
      return 'Network error reaching OpenRouter. Check your connection and try again.';
    case 'LLM_ERROR':
      return e.message || 'The model returned an unexpected response.';
    case 'INVALID_INPUT':
      return 'Invalid input — please retry from Step 1.';
    default:
      return e.message || 'Enrichment failed.';
  }
});

function answerValueFor(qid: string): string {
  const a = store.enrichAnswers.find((x) => x.questionId === qid);
  return a && a.status === 'answered' ? a.value : '';
}
function isSkipped(qid: string): boolean {
  const a = store.enrichAnswers.find((x) => x.questionId === qid);
  return !a || a.status === 'skipped';
}
function onAnswerInput(qid: string, ev: Event) {
  const target = ev.target as HTMLInputElement | null;
  store.setEnrichAnswer(qid, target?.value ?? '');
}
function onSkip(qid: string) {
  store.skipEnrichAnswer(qid);
}

function markerFor(action: string): string {
  if (action === 'append' || action === 'add_skill') return '+';
  if (action === 'replace') return '~';
  return '–';
}
function renderValue(c: { value: unknown }): string {
  if (typeof c.value === 'string') return c.value;
  if (Array.isArray(c.value)) return c.value.join(', ');
  try {
    return JSON.stringify(c.value);
  } catch {
    return String(c.value);
  }
}

function onAnalyze() {
  void store.analyzeEnrichment();
}
function onGenerateQuestions() {
  void store.generateEnrichmentQuestions();
}
function onPropose() {
  void store.proposeEnrichment();
}
function onApply() {
  void store.applyEnrichment();
}
function onAccept(idx: number) {
  if (!store.enrichAccepted.has(idx)) store.toggleEnrichAccept(idx);
}
function onReject(idx: number) {
  if (store.enrichAccepted.has(idx)) store.toggleEnrichAccept(idx);
}
function onBackToAnalyze() {
  store.enrichStatus = 'analyzed';
}
function onBackToQuestions() {
  store.enrichStatus = 'questioned';
}
function onReset() {
  store.resetEnrichment();
}
function onRetry() {
  // The retry target depends on which step failed — the easiest mental model
  // is "rewind one step and let the user re-trigger".
  store.enrichError = null;
  if (!store.enrichReport) {
    store.enrichStatus = 'idle';
  } else if (!store.enrichQuestionnaire) {
    store.enrichStatus = 'analyzed';
  } else if (!store.enrichProposals.length) {
    store.enrichStatus = 'questioned';
  } else {
    store.enrichStatus = 'proposed';
  }
}

function goProfile() {
  void router.push({ name: 'profile' });
}
function goSettings() {
  void router.push({ name: 'settings' });
}

onBeforeUnmount(() => {
  // Don't blow away state on navigation — the user might come back from a
  // brief Profile / Settings detour. Reset only on explicit "Done".
});
</script>

<style scoped lang="scss">
.enrich {
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}
.bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  &__title { font-size: 22px; color: var(--text-strong); }
  &__sub { font-size: 13px; color: var(--muted); }
}
.stepper {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  gap: 24px;
  align-items: center;
  border-bottom: 1px solid var(--hair);
  padding-bottom: 12px;
}
.step {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  &.is-active { color: var(--text-strong); font-weight: 600; }
  &.is-done { color: var(--accent); }
  &__n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent-tint);
    color: var(--text-strong);
    font-size: 12px;
  }
  &__l { font-size: 13px; }
}

.step-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel__head { display: flex; flex-direction: column; gap: 4px; }
.panel__title { font-size: 16px; font-weight: 600; color: var(--text-strong); margin: 0; }
.panel__sub { font-size: 13px; color: var(--muted); margin: 0; }
.panel__cta { margin-top: 12px; }
.panel__actions { display: flex; gap: 10px; margin-top: 18px; }

.weak__summary { font-size: 14px; color: var(--text-2); }
.weak__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.weak__item {
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.weak__path { font-size: 11px; color: var(--faint); }
.weak__text { font-size: 14px; color: var(--text-strong); }
.weak__reason { font-size: 12.5px; color: var(--muted); }
.weak__signals { display: flex; gap: 6px; flex-wrap: wrap; }
.weak__empty { color: var(--muted); font-style: italic; }
.signal {
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent-tint);
  color: var(--text-strong);
}

.questions {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.question {
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
  &__kind { font-size: 10.5px; color: var(--faint); text-transform: uppercase; }
  &__bullet { font-size: 12.5px; color: var(--muted); font-style: italic; }
  &__text { font-size: 14px; color: var(--text-strong); margin: 0; }
  &__row { display: flex; gap: 10px; align-items: center; }
  &__input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    font: 400 13.5px/1 var(--font-ui);
    background: var(--bg);
    color: var(--text-strong);
  }
  &__hint { font-size: 12px; color: var(--muted); font-style: italic; }
}

.proposal { display: flex; flex-direction: column; gap: 12px; }
.changes__legend {
  font-size: 11px;
  color: var(--muted);
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--hair);
}
.changes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.changes__item {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--hair);
  border-radius: 8px;
  background: var(--surface);
  &--accepted { border-color: var(--accent); background: var(--accent-tint); }
}
.changes__marker {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  text-align: center;
}
.changes__body { display: flex; flex-direction: column; gap: 4px; }
.changes__path { font-size: 11px; color: var(--faint); }
.changes__before, .changes__after { font-size: 13px; }
.before-label, .after-label, .provenance-label {
  font-size: 10px;
  color: var(--faint);
  margin-right: 6px;
}
.before-text { color: var(--muted); text-decoration: line-through; }
.after-text { color: var(--text-strong); }
.changes__reason { font-size: 12.5px; color: var(--muted); }
.changes__provenance { font-size: 12px; color: var(--muted); }
.changes__gate { font-size: 12px; color: #b03a3a; }
.changes__actions { display: flex; flex-direction: column; gap: 6px; }
.changes__empty { color: var(--muted); font-style: italic; }

.loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
  padding: 12px 0;
}

.state {
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 18px 20px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
  &__title { font-size: 16px; color: var(--text-strong); }
  &__msg { font-size: 13px; color: var(--muted); margin: 0; }
  &__code { font-size: 11px; color: var(--faint); margin: 0; }
  &--error { border-color: #b03a3a; background: rgba(176, 58, 58, 0.05); }
  &--applied { border-color: var(--accent); background: var(--accent-tint); }
}
</style>
