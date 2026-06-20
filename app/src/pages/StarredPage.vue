<template>
  <div class="screen">
    <div class="head">
      <div>
        <h1 class="page-title">Starred</h1>
        <p class="sub">Your shortlist — jobs you starred on the Job Board.</p>
      </div>
    </div>

    <div v-if="store.starredJobs.length === 0" class="empty">
      <div class="font-serif empty__title">No starred jobs yet</div>
      <p class="empty__sub">Star a job on the Job Board to shortlist it here.</p>
    </div>

    <div class="grid">
      <article
        v-for="j in orderedStarred"
        :key="j.sourceId"
        class="tile"
        :class="{ 'tile--strong': isStrong(store.scores[j.sourceId]) }"
      >
        <header class="tile__head">
          <span class="monogram tile__mono">{{ initial(j) }}</span>
          <div class="tile__meta">
            <div class="tile__title">{{ j.title || j.url }}</div>
            <div class="tile__sub">{{ subtitle(j) }}</div>
          </div>
          <span class="tile__tag">{{ j.hostname }}</span>
        </header>

        <div class="tile__score">
          <template v-if="store.scores[j.sourceId]">
            <StarRating :score="store.scores[j.sourceId]!.stars" />
            <span class="tile__percent">{{ Math.round(store.scores[j.sourceId]!.percent) }}% match</span>
            <span
              v-if="store.scores[j.sourceId]!.stale"
              class="tile__stale"
              title="Score is out of date — rescore to refresh"
            >stale</span>
          </template>
          <span v-else class="tile__unscored">Not scored yet</span>
        </div>

        <hr class="hair" />

        <footer class="tile__actions">
          <q-btn unelevated color="primary" no-caps class="col-grow" label="Open" @click="store.openJob(j.url)" />
          <q-btn
            unelevated
            no-caps
            color="secondary"
            class="generate"
            label="Generate"
            :disable="!tailoringAvailable"
            :title="tailorDisabledReason ?? 'Generate a tailored CV + cover letter for this job'"
            @click="openTailor(j.sourceId)"
          />
          <q-btn
            unelevated
            no-caps
            color="secondary"
            class="eval"
            label="Eval"
            :loading="store.evalGenerateStateFor(j.sourceId).status === 'loading'"
            :disable="!store.canGenerateEval(j.sourceId)"
            :title="store.canGenerateEval(j.sourceId) ? 'Open or generate the Job Evaluation Report' : store.evalDisabledReason(j.sourceId)"
            @click="openEval(j.sourceId)"
          />
          <q-btn
            outline
            no-caps
            class="dismiss"
            label="Unstar"
            @click="store.setJobStatus({ sourceId: j.sourceId, status: 'new' })"
          />
        </footer>
      </article>
    </div>

    <q-dialog v-model="showWebResearchDisclosure">
      <q-card class="disclosure">
        <div class="font-serif disclosure__title">Web research is local-only</div>
        <p class="disclosure__body">{{ store.webResearchSetting?.disclosure }}</p>
        <div class="disclosure__actions">
          <q-btn v-close-popup outline no-caps class="ghost" label="Cancel" />
          <q-btn unelevated color="primary" no-caps label="I understand" @click="confirmWebResearchDisclosure" />
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import type { JobRecord, MatchScore } from 'src/types/models';

const store = useAppStore();
const router = useRouter();

/**
 * TAILOR-006 AC1/AC2 — the Generate button deep-links to the Tailor view
 * (a named route, NOT a sidebar item) and is disabled with a clear reason
 * when the OpenRouter key or a default model is missing.
 */
const hasDefaultModel = computed<boolean>(() =>
  store.preferredModels.some((m) => m.isDefault),
);
const tailoringAvailable = computed<boolean>(
  () => store.isTailoringAvailable && hasDefaultModel.value,
);
const tailorDisabledReason = computed<string | null>(() => {
  if (!store.isTailoringAvailable) {
    return 'Add an OpenRouter API key in Settings to enable tailoring.';
  }
  if (!hasDefaultModel.value) {
    return 'Choose a default model in Settings to enable tailoring.';
  }
  return null;
});

function openTailor(sourceId: string): void {
  void router.push({ name: 'tailor', query: { sourceId } });
}

/**
 * EVAL-005 AC2 — open or generate the Job Evaluation Report for one
 * starred job. If a fresh, non-stale cached report already exists, the
 * action is a no-op on the network side (the caller can route to a
 * report view if/when one is wired up); otherwise it kicks off the
 * EVAL-004 orchestrator via the store action.
 *
 * EVAL-005 AC3 — when the user has opted into web research but not yet
 * acknowledged the EVAL-004 disclosure, the disclosure dialog is shown
 * first; the generate call is deferred until the user confirms.
 */
const showWebResearchDisclosure = ref(false);
const pendingEvalSourceId = ref<string | null>(null);
async function openEval(sourceId: string): Promise<void> {
  if (!store.canGenerateEval(sourceId)) return;
  await store.hydrateWebResearchSetting();
  if (store.webResearchSetting?.webResearchEnabled && store.needsWebResearchDisclosure) {
    pendingEvalSourceId.value = sourceId;
    showWebResearchDisclosure.value = true;
    return;
  }
  if (store.hasEvalReport(sourceId) && !store.isEvalReportStale(sourceId)) {
    await store.getEvalReport(sourceId);
    void router.push({ name: 'eval', query: { sourceId } });
    return;
  }
  await store.generateEval(sourceId);
  // EVAL-006 — navigate to the report view regardless of outcome; the view
  // renders per-code loading/error states for failures so the user lands on a
  // surface that explains what happened, not a silently-failed click.
  void router.push({ name: 'eval', query: { sourceId } });
}
async function confirmWebResearchDisclosure(): Promise<void> {
  await store.acknowledgeWebResearchDisclosure();
  const id = pendingEvalSourceId.value;
  showWebResearchDisclosure.value = false;
  pendingEvalSourceId.value = null;
  if (id) {
    await store.generateEval(id);
    void router.push({ name: 'eval', query: { sourceId: id } });
  }
}

const STRONG_STARS = 4;
function isStrong(score: MatchScore | undefined): boolean {
  return !!score && score.stars >= STRONG_STARS;
}

/**
 * Starred ordering (SCORE-006 AC2): strong matches lead, then by percent
 * descending; unscored tiles sort last by fetch recency.
 */
const orderedStarred = computed<JobRecord[]>(() => {
  const orderKey = (j: JobRecord) => store.scores[j.sourceId]?.percent ?? -1;
  return [...store.starredJobs].sort((a, b) => {
    const diff = orderKey(b) - orderKey(a);
    if (diff !== 0) return diff;
    return b.fetchedAt - a.fetchedAt;
  });
});

function initial(j: JobRecord): string {
  const src = j.company || j.title || j.hostname || '?';
  return src.trim().charAt(0).toUpperCase() || '?';
}

function subtitle(j: JobRecord): string {
  return [j.company, j.location].filter(Boolean).join(' · ') || j.hostname;
}

onMounted(async () => {
  await store.listJobs();
  await store.listScores();
  await store.hydrateApiKeyStatus();
  await store.hydratePreferredModels();
  await store.hydrateWebResearchSetting();
});
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.sub { margin: 7px 0 0; font-size: 14px; color: var(--text-3); }
.restore-btn { color: var(--text-2); border-color: var(--border-strong); }

.empty { border: 1.5px dashed var(--border-strong); border-radius: 14px; padding: 54px; text-align: center; margin-bottom: 16px; }
.empty__title { font-size: 22px; color: var(--text-3); }
.empty__sub { font-size: 13.5px; color: var(--muted); margin: 8px 0 0; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(296px, 1fr)); gap: 16px; }

.tile {
  border: 1px solid var(--hair);
  border-radius: 14px;
  background: var(--card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  &:hover { border-color: var(--border-strong); }
  &--strong { border-color: var(--accent); }
  &__head { display: flex; align-items: flex-start; gap: 12px; }
  &__mono { width: 42px; height: 42px; font-size: 17px; }
  &__meta { flex: 1; min-width: 0; }
  &__title {
    font-size: 15.5px; font-weight: 700; line-height: 1.25;
    min-height: 39px;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  &__sub {
    font-size: 12.5px; color: var(--muted); margin-top: 3px; line-height: 1.35;
    min-height: 34px;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  &__tag { font: 500 10px/1 var(--font-mono); color: var(--olive-text); background: var(--olive-tint); padding: 4px 7px; border-radius: 5px; flex-shrink: 0; }
  &__score { display: flex; align-items: center; gap: 8px; min-height: 18px; }
  &__percent { font: 500 12px/1 var(--font-mono); color: var(--text-2); }
  &__stale { font: 500 10px/1 var(--font-mono); color: var(--olive-text); background: var(--olive-tint); padding: 3px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  &__unscored { font-size: 12.5px; color: var(--muted); font-style: italic; }
  &__actions { display: flex; gap: 9px; }
}
.col-grow { flex: 1; }
.dismiss { color: var(--muted); border-color: var(--border-strong); }
.generate { color: var(--accent-hover); background: var(--accent-tint); }
.eval { color: var(--accent-hover); background: var(--accent-tint); }
.disclosure {
  width: 420px;
  max-width: 90vw;
  padding: 24px;
  border-radius: 14px;
  background: var(--bg);
}
.disclosure__title { font-size: 20px; line-height: 1.2; color: var(--text-1); }
.disclosure__body { font-size: 13px; color: var(--text-2); line-height: 1.55; margin: 14px 0 0; white-space: pre-line; }
.disclosure__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }
</style>
