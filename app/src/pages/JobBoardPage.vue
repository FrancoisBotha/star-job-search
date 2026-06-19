<template>
  <div class="screen">
    <div class="head">
      <div>
        <h1 class="page-title">Job Board</h1>
        <p class="sub">Every job extracted across your tracked boards. Star the ones worth a closer look.</p>
      </div>
      <div class="head__actions">
        <q-btn
          v-if="store.notInterestedCount > 0"
          outline
          no-caps
          class="restore-btn"
          :label="`Restore ${store.notInterestedCount} hidden`"
          @click="store.restoreNotInterested()"
        />
        <!-- EXTR-012: destructive "delete all imported jobs" affordance.
             Disabled when the board is already empty so the user can never
             trigger a confirm against a no-op. -->
        <q-btn
          flat
          round
          dense
          icon="mdi-delete-sweep-outline"
          class="delete-all-btn"
          aria-label="Delete all imported jobs"
          title="Delete all imported jobs"
          :disable="store.jobs.length === 0"
          @click="confirmDeleteAll = true"
        />
      </div>
    </div>

    <q-dialog v-model="confirmDeleteAll" persistent>
      <q-card class="confirm">
        <div class="confirm__title font-serif">Delete all imported jobs?</div>
        <p class="confirm__body">
          This permanently removes every imported job, along with their match
          scores and AI reviews. The next AI Extract run will re-import jobs
          from scratch. This cannot be undone.
        </p>
        <div class="confirm__actions">
          <q-btn v-close-popup flat no-caps label="Cancel" />
          <q-btn
            v-close-popup
            unelevated
            color="negative"
            no-caps
            label="Delete all"
            @click="deleteAll"
          />
        </div>
      </q-card>
    </q-dialog>

    <div v-if="store.visibleJobs.length === 0" class="empty">
      <div class="font-serif empty__title">No imported jobs yet</div>
      <p class="empty__sub">Open a tracked board on Discover and run AI Extract to fill this view.</p>
    </div>

    <div class="grid">
      <article
        v-for="j in orderedJobs"
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
          <q-btn unelevated color="primary" no-caps class="col-grow" label="Detail" @click="openDetail(j)" />
          <q-btn
            outline
            no-caps
            class="ai-btn"
            label="AI"
            title="Open the AI Match Review for this job"
            aria-label="Open AI Match Review"
            @click="openReview(j)"
          />
          <button
            type="button"
            class="star"
            :class="{ 'star--on': j.status === 'starred' }"
            :title="j.status === 'starred' ? 'Unstar' : 'Star'"
            :aria-label="j.status === 'starred' ? 'Unstar' : 'Star'"
            @click="toggleStar(j)"
          >
            {{ j.status === 'starred' ? '★' : '☆' }}
          </button>
          <q-btn
            outline
            no-caps
            class="dismiss"
            label="Not interested"
            @click="store.setJobStatus({ sourceId: j.sourceId, status: 'not_interested' })"
          />
        </footer>
      </article>
    </div>

    <JobDetailDialog
      v-if="selectedJob"
      v-model="detailOpen"
      :job="selectedJob"
      :focus-review="focusReview"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import JobDetailDialog from 'src/components/JobDetailDialog.vue';
import StarRating from 'src/components/StarRating.vue';
import type { JobRecord, MatchScore } from 'src/types/models';

const store = useAppStore();

const detailOpen = ref(false);
const selectedJob = ref<JobRecord | null>(null);
const focusReview = ref(false);
const confirmDeleteAll = ref(false);

async function deleteAll() {
  await store.deleteAllJobs();
}

/**
 * Strong-match threshold (Epic 5 §3) — a score reads as a "match" when its
 * stars clear ★4+. Unscored or sub-threshold tiles still render, just
 * without the strong-match emphasis.
 */
const STRONG_STARS = 4;
function isStrong(score: MatchScore | undefined): boolean {
  return !!score && score.stars >= STRONG_STARS;
}

/**
 * Board ordering (SCORE-006 AC2): strong matches lead, then everything
 * else by score percent (descending). Unscored jobs sort last; within an
 * equal-score group the newer fetch wins so the existing newest-first
 * behaviour survives for unscored tiles.
 */
const orderedJobs = computed<JobRecord[]>(() => {
  const orderKey = (j: JobRecord) => store.scores[j.sourceId]?.percent ?? -1;
  return [...store.visibleJobs].sort((a, b) => {
    const diff = orderKey(b) - orderKey(a);
    if (diff !== 0) return diff;
    return b.fetchedAt - a.fetchedAt;
  });
});

function openDetail(j: JobRecord) {
  selectedJob.value = j;
  focusReview.value = false;
  detailOpen.value = true;
}

function openReview(j: JobRecord) {
  selectedJob.value = j;
  focusReview.value = true;
  detailOpen.value = true;
}

function initial(j: JobRecord): string {
  const src = j.company || j.title || j.hostname || '?';
  return src.trim().charAt(0).toUpperCase() || '?';
}

function subtitle(j: JobRecord): string {
  return [j.company, j.location].filter(Boolean).join(' · ') || j.hostname;
}

/** Toggle a job between starred (shortlisted on the Starred page) and new. */
function toggleStar(j: JobRecord) {
  const next = j.status === 'starred' ? 'new' : 'starred';
  void store.setJobStatus({ sourceId: j.sourceId, status: next });
}

onMounted(async () => {
  await store.listJobs();
  await store.listScores();
});
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.sub { margin: 7px 0 0; font-size: 14px; color: var(--text-3); }
.restore-btn { color: var(--text-2); border-color: var(--border-strong); }
.head__actions { display: flex; align-items: center; gap: 8px; }
.delete-all-btn { color: var(--muted); &:hover { color: var(--negative, #c0392b); } }

.confirm { padding: 28px 30px; max-width: 460px; }
.confirm__title { font-size: 20px; }
.confirm__body { font-size: 14px; color: var(--text-3); margin: 12px 0 18px; line-height: 1.45; }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }

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
  &__actions { display: flex; align-items: stretch; gap: 9px; }
}
.col-grow { flex: 1; }
.dismiss { color: var(--muted); border-color: var(--border-strong); }
.ai-btn {
  flex-shrink: 0;
  color: var(--accent);
  border-color: var(--border-strong);
  font: 600 12px/1 var(--font-mono);
  letter-spacing: 0.06em;
  padding: 0 10px;
  &:hover { border-color: var(--accent); }
}
.star {
  width: 38px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border-strong); border-radius: 8px;
  font-size: 17px; line-height: 1; color: var(--muted); cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  &:hover { color: var(--accent); border-color: var(--accent); }
  &--on { color: var(--accent); border-color: var(--accent); background: var(--accent-tint); }
}
</style>
