<template>
  <div class="eval app-scroll">
    <div class="bar">
      <q-btn flat dense no-caps class="bar__back" @click="goBack">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 3 5 8 9 13" /></svg>
        Starred
      </q-btn>
      <div class="bar__title font-serif">Job Evaluation Report</div>
      <div class="bar__right">
        <q-btn
          unelevated
          no-caps
          dense
          color="primary"
          class="eval-export-md"
          data-test="eval-export-md"
          :disable="!report"
          @click="exportMarkdown"
        >
          Export · Markdown
        </q-btn>
        <q-btn
          outline
          dense
          no-caps
          class="eval-regen"
          :loading="evalState.status === 'loading'"
          :disable="!store.canGenerateEval(sourceId)"
          @click="regenerate"
        >Regenerate</q-btn>
      </div>
    </div>

    <!-- Header (AC1) ------------------------------------------------ -->
    <header class="head" v-if="job">
      <div class="head__meta">
        <div class="font-serif head__title">{{ job.title || job.url }}</div>
        <div class="head__sub">
          <span v-if="job.company">{{ job.company }}</span>
          <span v-if="job.company && job.location" class="sep">·</span>
          <span v-if="job.location">{{ job.location }}</span>
        </div>
      </div>

      <div class="head__chips">
        <!-- Deterministic Epic 5 rating — the ONLY numeric rating on screen -->
        <div class="head__score" v-if="score">
          <StarRating :score="score.stars" :size="17" :gap="3" />
          <span class="font-mono head__pct">{{ Math.round(score.percent) }}%</span>
        </div>
        <div class="head__archetype" data-test="eval-archetype">
          <span class="head__label">Archetype</span>
          <span class="head__val">{{ archetypeLabel }}</span>
        </div>
        <span
          class="legitimacy"
          :class="legitimacyClass"
          data-test="eval-legitimacy-chip"
        >{{ legitimacyLabel }}</span>
        <span class="advisory" data-test="eval-advisory-badge">
          <span class="advisory__pill">AI</span>
          <span class="advisory__txt">advisory</span>
        </span>
      </div>

      <p class="verification" data-test="eval-verification-line">
        Verification: {{ verificationNote }}
      </p>

      <p class="provenance font-mono" data-test="eval-provenance">
        Eval · {{ modelSlug || 'unknown model' }} ·
        {{ generatedAtLabel }}
      </p>

      <div
        v-if="report && report.stale"
        class="stale"
        data-test="eval-stale-banner"
      >
        This report may be out of date — Regenerate to refresh.
      </div>
    </header>

    <!-- Loading / error states ------------------------------------- -->
    <div
      v-if="evalState.status === 'loading'"
      class="state state--loading"
      data-test="eval-loading"
    >
      <q-spinner color="primary" size="20px" />
      <span>Generating evaluation&hellip;</span>
    </div>

    <div
      v-if="evalState.status === 'error' && evalState.code"
      class="state state--error"
      role="alert"
    >
      <p class="state__msg">{{ errorMessage }}</p>
      <p class="state__code"><span class="font-mono">{{ evalState.code }}</span></p>
      <q-btn outline no-caps color="primary" label="Try again" @click="regenerate" />
    </div>

    <!-- Block A ---------------------------------------------------- -->
    <q-expansion-item
      v-if="report"
      data-block="A"
      label="A · Role Summary &amp; Employer Context"
      default-opened
      class="block"
    >
      <p class="block__body">{{ report.blockA }}</p>
    </q-expansion-item>

    <!-- Block B (Epic 6 AI Match Review — reused) ------------------ -->
    <q-expansion-item
      data-block="B"
      label="B · Match with CV (AI Match Review)"
      class="block"
      default-opened
    >
      <div v-if="review" class="block__body">
        <p class="review__summary">{{ review.summary }}</p>

        <h4 class="block__h4">Requirements</h4>
        <ul class="review__list">
          <li v-for="(r, ri) in review.requirements" :key="`req-${ri}`">
            <span>{{ r.requirement }}</span>
            <span v-if="r.met" class="met">met</span>
            <span v-else class="notfound">not found</span>
            <p v-if="r.evidence" class="evidence">Evidence: {{ r.evidence }}</p>
          </li>
        </ul>

        <h4 v-if="review.gaps.length" class="block__h4">Gaps</h4>
        <ul v-if="review.gaps.length" class="review__list">
          <li v-for="(g, gi) in review.gaps" :key="`gap-${gi}`">
            <span>{{ g.text }}</span>
            <span :class="g.severity === 'blocker' ? 'blocker' : 'nice'">
              {{ g.severity === 'blocker' ? 'blocker' : 'nice-to-have' }}
            </span>
            <p class="evidence">Mitigation: {{ g.mitigation }}</p>
          </li>
        </ul>

        <h4 v-if="review.strengths.length" class="block__h4">Strengths</h4>
        <ul v-if="review.strengths.length" class="review__bullets">
          <li v-for="(s, si) in review.strengths" :key="`str-${si}`">{{ s }}</li>
        </ul>
      </div>
      <p v-else class="block__empty">
        No AI Match Review cached for this job yet. Open the job's detail dialog
        to generate one.
      </p>
    </q-expansion-item>

    <!-- Block C ---------------------------------------------------- -->
    <q-expansion-item
      v-if="report"
      data-block="C"
      label="C · Level &amp; Strategy"
      class="block"
    >
      <p class="block__body">{{ report.blockC }}</p>
    </q-expansion-item>

    <!-- Block D — Compensation table + sources -------------------- -->
    <q-expansion-item
      v-if="report"
      data-block="D"
      label="D · Compensation"
      class="block"
    >
      <p class="block__body">{{ report.blockD }}</p>

      <table class="comp" data-test="eval-comp-table">
        <thead>
          <tr><th>Line</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Stated (statedCompensation)</td>
            <td>{{ statedCompensation || 'not stated' }}</td>
          </tr>
          <tr>
            <td>Expectation (compensationExpectation)</td>
            <td>{{ compensationExpectation || 'not stated' }}</td>
          </tr>
        </tbody>
      </table>

      <h4 class="block__h4">Sources</h4>
      <ul class="sources" data-test="eval-d-sources">
        <li v-for="(s, si) in report.sources" :key="`src-${si}`">
          <a href="#" class="src-link" @click.prevent="openSource(s.url)">
            {{ s.title || s.url }}
          </a>
        </li>
        <li v-if="!report.sources.length" class="src-empty">
          No sources cited.
        </li>
      </ul>
    </q-expansion-item>

    <!-- Block E — CTA: Tailor ------------------------------------- -->
    <q-expansion-item
      data-block="E"
      label="E · Tailored CV"
      class="block"
    >
      <p class="block__body">
        Launch the Tailoring workspace to produce a tailored CV for this role.
      </p>
      <q-btn
        unelevated
        no-caps
        color="primary"
        label="Open Tailor"
        data-cta="tailor"
        @click="openTailor"
      />
    </q-expansion-item>

    <!-- Block F — CTA: Interview Prep ----------------------------- -->
    <q-expansion-item
      data-block="F"
      label="F · Interview Prep"
      class="block"
    >
      <p class="block__body">
        Launch the Interview Prep brief tailored to this role.
      </p>
      <q-btn
        unelevated
        no-caps
        color="primary"
        label="Open Interview Prep"
        data-cta="interview-prep"
        @click="openInterviewPrep"
      />
    </q-expansion-item>

    <!-- Block G — Signal table + confidence ----------------------- -->
    <q-expansion-item
      v-if="report"
      data-block="G"
      label="G · Legitimacy Signals"
      class="block"
    >
      <p class="block__body">{{ report.blockG }}</p>
      <table class="signals" data-test="eval-signal-table">
        <thead>
          <tr><th>Signal</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Legitimacy verdict</td>
            <td>{{ legitimacyLabel }}</td>
          </tr>
          <tr>
            <td>Verification note</td>
            <td>{{ verificationNote }}</td>
          </tr>
          <tr>
            <td>Confidence</td>
            <td>{{ confidenceLabel }}</td>
          </tr>
        </tbody>
      </table>
    </q-expansion-item>

    <!-- Block H — CTA: Cover letter + apply ----------------------- -->
    <q-expansion-item
      data-block="H"
      label="H · Cover Letter &amp; Apply"
      class="block"
    >
      <p v-if="report" class="block__body">{{ report.blockH || 'Launch the cover-letter writer and apply flow for this role.' }}</p>
      <q-btn
        unelevated
        no-caps
        color="primary"
        label="Open Cover Letter &amp; Apply"
        data-cta="cover-letter-apply"
        @click="openCoverLetterApply"
      />
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import type { JobRecord, MatchScore } from 'src/types/models';
import type {
  EvalReportRecord,
  EvalGenerateState,
  MatchReview,
} from 'src/stores/app-store';

/**
 * Job Evaluation Report view (EVAL-006 / Epic 14). Header carries the
 * deterministic Epic 5 stars/% rating, the role archetype, the legitimacy
 * chip and verification line from the persisted report, plus provenance
 * (model slug + generated date). The narrative blocks (A–H) are collapsible:
 *
 *  A — Role summary + employer context
 *  B — Match with CV (reuses the Epic 6 AI Match Review by `sourceId`)
 *  C — Level & strategy
 *  D — Compensation: stated vs expectation + cited sources
 *  E — Tailored CV (CTA — opens the Tailor view)
 *  F — Interview Prep (CTA — opens Interview Prep)
 *  G — Legitimacy signals + verification confidence
 *  H — Cover letter & apply (CTA)
 *
 * Hard boundary (Epic 6 / Epic 14 §4): NO LLM-produced number appears
 * anywhere — the only numeric rating is the deterministic Epic 5 stars/%.
 * The advisory "AI" badge is rendered separately so the reader can never
 * mistake a narrative judgement for the deterministic score.
 */
const route = useRoute();
const router = useRouter();
const store = useAppStore();

const sourceId = computed<string>(() => {
  const raw = route.query.sourceId;
  return typeof raw === 'string' ? raw : '';
});

const job = computed<JobRecord | undefined>(() =>
  store.jobs.find((j) => j.sourceId === sourceId.value),
);

const score = computed<MatchScore | null>(
  () => store.scores[sourceId.value] ?? null,
);

const report = computed<EvalReportRecord | null>(
  () => store.evalReports[sourceId.value] ?? null,
);

const review = computed<MatchReview | null>(
  () => store.reviews[sourceId.value] ?? null,
);

const evalState = computed<EvalGenerateState>(() =>
  store.evalGenerateStateFor(sourceId.value),
);

const archetypeLabel = computed<string>(() => {
  const r = review.value;
  if (r?.archetype) return r.archetype;
  return 'not specified';
});

const modelSlug = computed<string>(() => report.value?.modelSlug ?? '');

const generatedAtLabel = computed<string>(() => {
  const t = report.value?.generatedAt;
  if (!t) return '—';
  try {
    return new Date(t).toLocaleString();
  } catch {
    return String(t);
  }
});

const legitimacyLabel = computed<string>(() => {
  return report.value?.legitimacyVerdict || 'unknown';
});

const legitimacyClass = computed<string>(() => {
  const v = legitimacyLabel.value;
  if (v === 'legitimate') return 'legitimacy--ok';
  if (v === 'suspicious') return 'legitimacy--warn';
  return 'legitimacy--unknown';
});

const verificationNote = computed<string>(() => {
  return report.value?.verificationNote || 'not verified';
});

const confidenceLabel = computed<string>(() => {
  const note = verificationNote.value.toLowerCase();
  if (/uncertain/.test(note)) return 'uncertain';
  if (legitimacyLabel.value === 'legitimate') return 'high';
  if (legitimacyLabel.value === 'suspicious') return 'low';
  return 'unknown';
});

const statedCompensation = computed<string>(() => job.value?.salary ?? '');
const compensationExpectation = computed<string>(() => {
  const min = store.profile?.salaryMin;
  if (!min) return '';
  const cur = store.profile?.salaryCurrency || '';
  return `${cur} ${min}`.trim();
});

/**
 * Per-code error copy. The EVAL-004 IPC returns one of the
 * StarEvalErrorCode union members — render specific text per code so the
 * user sees the exact remedy (FR-006 / NFR-004).
 */
const ERROR_COPY: Record<string, string> = {
  NO_API_KEY: 'Add an OpenRouter API key in Settings to enable Eval.',
  MODEL_NOT_CAPABLE:
    'The selected model does not support structured output. Pick a function-calling capable model under Settings → Preferred models.',
  RATE_LIMITED:
    'OpenRouter rate-limited the request. Wait a moment and try again.',
  NETWORK: 'Network error reaching OpenRouter. Check your connection and retry.',
  NO_SCORE:
    'Rescore this job from the Job Board first — the eval report uses the deterministic match score.',
};

const errorMessage = computed<string>(() => {
  const c = evalState.value.code;
  if (!c) return evalState.value.message || 'Unknown error';
  return ERROR_COPY[c] ?? evalState.value.message ?? 'Unknown error';
});

function goBack(): void {
  void router.push({ name: 'starred' });
}

async function regenerate(): Promise<void> {
  if (!store.canGenerateEval(sourceId.value)) return;
  await store.generateEval(sourceId.value);
}

function openTailor(): void {
  void router.push({ name: 'tailor', query: { sourceId: sourceId.value } });
}
function openInterviewPrep(): void {
  // Interview-Prep is a future view (Epic 13). The CTA navigates to the
  // Tailor view today so the launch surface is stable; replace with the
  // dedicated route once it ships.
  void router.push({ name: 'tailor', query: { sourceId: sourceId.value, focus: 'interview-prep' } });
}
function openCoverLetterApply(): void {
  void router.push({ name: 'tailor', query: { sourceId: sourceId.value, focus: 'cover-letter' } });
}

function openSource(url: string): void {
  void store.openExternal(url);
}

/**
 * Compose the Markdown export (AC3). Pure local — no IPC, no submission.
 * Writes a Blob URL into a temporary anchor and clicks it so the user gets a
 * native save dialog. Composes alongside Epic 12 export channels (the Word/
 * PDF flows live in Tailor; this surface stays Markdown-only for the eval
 * narrative + cited sources).
 */
function exportMarkdown(): void {
  const r = report.value;
  if (!r) return;
  const md = buildMarkdown(r);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = (job.value?.title || sourceId.value).replace(/[^A-Za-z0-9._-]+/g, '_');
  a.download = `eval-${slug}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildMarkdown(r: EvalReportRecord): string {
  const lines: string[] = [];
  const j = job.value;
  lines.push(`# Job Evaluation Report — ${j?.title ?? sourceId.value}`);
  if (j?.company) lines.push(`**Company:** ${j.company}`);
  if (j?.location) lines.push(`**Location:** ${j.location}`);
  if (score.value) {
    lines.push(
      `**Rating:** ${score.value.stars.toFixed(1)} stars (${Math.round(score.value.percent)}%) — deterministic Epic 5 score`,
    );
  }
  lines.push(`**Archetype:** ${archetypeLabel.value}`);
  lines.push(`**Legitimacy:** ${legitimacyLabel.value}`);
  lines.push(`**Verification:** ${verificationNote.value}`);
  lines.push(`**Eval · ${r.modelSlug || 'unknown model'} · ${generatedAtLabel.value}**`);
  if (r.stale) lines.push(`> _This report may be out of date — Regenerate to refresh._`);
  lines.push('');
  lines.push('## A · Role Summary & Employer Context');
  lines.push(r.blockA || '_(not generated)_');
  lines.push('');
  if (review.value) {
    lines.push('## B · Match with CV (AI Match Review)');
    lines.push(review.value.summary);
  }
  lines.push('');
  lines.push('## C · Level & Strategy');
  lines.push(r.blockC || '_(not generated)_');
  lines.push('');
  lines.push('## D · Compensation');
  lines.push(r.blockD || '_(not generated)_');
  lines.push('');
  lines.push(`- Stated: ${statedCompensation.value || 'not stated'}`);
  lines.push(`- Expectation: ${compensationExpectation.value || 'not stated'}`);
  if (r.sources.length) {
    lines.push('');
    lines.push('### Sources');
    for (const s of r.sources) lines.push(`- [${s.title || s.url}](${s.url})`);
  }
  lines.push('');
  lines.push('## G · Legitimacy Signals');
  lines.push(r.blockG || '_(not generated)_');
  lines.push(`- Verdict: ${legitimacyLabel.value}`);
  lines.push(`- Confidence: ${confidenceLabel.value}`);
  if (r.blockH) {
    lines.push('');
    lines.push('## H · Cover Letter & Apply');
    lines.push(r.blockH);
  }
  return lines.join('\n');
}

onMounted(async () => {
  await store.listJobs();
  await store.listScores();
  await store.hydrateApiKeyStatus();
  await store.hydratePreferredModels();
  if (sourceId.value) {
    await store.getEvalReport(sourceId.value);
    await store.getReview(sourceId.value);
  }
});
</script>

<style scoped lang="scss">
.eval { padding: 24px 36px 64px; max-width: 1080px; margin: 0 auto; }

.bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.bar__back { color: var(--text-2); }
.bar__title { font-size: 20px; flex: 1; }
.bar__right { display: flex; gap: 10px; }

.head { border: 1px solid var(--hair); background: var(--card); border-radius: 14px; padding: 18px 20px; margin-bottom: 16px; }
.head__title { font-size: 20px; line-height: 1.2; }
.head__sub { font-size: 13.5px; color: var(--text-3); margin-top: 4px; }
.head__chips { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
.head__score { display: flex; align-items: center; gap: 8px; }
.head__pct { font: 500 13px/1 var(--font-mono); color: var(--text-2); }
.head__archetype { display: flex; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.head__label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font: 500 10px/1 var(--font-mono); }
.head__val { font-weight: 500; }
.sep { color: var(--muted); margin: 0 4px; }

.legitimacy { font: 500 11px/1 var(--font-mono); padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.legitimacy--ok { background: var(--olive-tint); color: var(--olive-text); }
.legitimacy--warn { background: rgba(184, 96, 48, 0.18); color: var(--accent-hover); }
.legitimacy--unknown { background: var(--hair); color: var(--muted); }

.advisory { display: inline-flex; align-items: center; gap: 6px; }
.advisory__pill { font: 600 10px/1 var(--font-mono); padding: 3px 6px; border-radius: 4px; background: var(--accent-tint); color: var(--accent-hover); }
.advisory__txt { font-size: 11px; color: var(--muted); font-style: italic; }

.verification { margin: 12px 0 0; font-size: 13px; color: var(--text-2); }
.provenance { margin: 6px 0 0; font-size: 11px; color: var(--muted); }
.stale { margin-top: 12px; padding: 8px 12px; background: var(--accent-tint); color: var(--accent-hover); border-radius: 6px; font-size: 12.5px; }

.state { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; }
.state--loading { background: var(--card); border: 1px dashed var(--hair); color: var(--text-2); }
.state--error { background: rgba(184, 96, 48, 0.08); border: 1px solid var(--accent-hover); flex-direction: column; align-items: flex-start; }
.state__msg { margin: 0; font-size: 13.5px; color: var(--text-1); }
.state__code { margin: 4px 0 8px; font-size: 11px; color: var(--muted); }

.block { border: 1px solid var(--hair); border-radius: 10px; margin-bottom: 10px; background: var(--card); }
.block__body { margin: 0; padding: 4px 16px 12px; font-size: 13.5px; color: var(--text-1); line-height: 1.6; white-space: pre-line; }
.block__h4 { margin: 16px 16px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.block__empty { padding: 12px 16px; color: var(--muted); font-style: italic; }

.review__summary { padding: 4px 16px 8px; margin: 0; }
.review__list { list-style: none; padding: 0 16px 8px; margin: 0; }
.review__list li { padding: 6px 0; border-bottom: 1px solid var(--hair); }
.review__bullets { padding: 0 16px 8px 32px; margin: 0; }
.met { font: 500 10px/1 var(--font-mono); margin-left: 8px; color: var(--olive-text); }
.notfound { font: 500 10px/1 var(--font-mono); margin-left: 8px; color: var(--muted); }
.blocker { font: 500 10px/1 var(--font-mono); margin-left: 8px; color: var(--accent-hover); }
.nice { font: 500 10px/1 var(--font-mono); margin-left: 8px; color: var(--text-3); }
.evidence { font-size: 12px; color: var(--muted); margin: 4px 0 0; }

table.comp, table.signals { width: calc(100% - 32px); margin: 8px 16px; border-collapse: collapse; font-size: 13px; }
table.comp th, table.comp td, table.signals th, table.signals td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--hair); }
table.comp th, table.signals th { color: var(--muted); font-weight: 500; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }

.sources { list-style: none; padding: 0 16px 12px; margin: 0; }
.src-link { color: var(--accent-hover); text-decoration: none; }
.src-link:hover { text-decoration: underline; }
.src-empty { color: var(--muted); font-style: italic; }
</style>
