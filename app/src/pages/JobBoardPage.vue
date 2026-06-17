<template>
  <div class="screen">
    <div class="head">
      <div>
        <h1 class="page-title">Job Board</h1>
        <p class="sub">Every job extracted across your tracked boards. Star the ones worth a closer look.</p>
      </div>
      <q-btn
        v-if="store.notInterestedCount > 0"
        outline
        no-caps
        class="restore-btn"
        :label="`Restore ${store.notInterestedCount} hidden`"
        @click="store.restoreNotInterested()"
      />
    </div>

    <div v-if="store.visibleJobs.length === 0" class="empty">
      <div class="font-serif empty__title">No imported jobs yet</div>
      <p class="empty__sub">Open a tracked board on Discover and run AI Extract to fill this view.</p>
    </div>

    <div class="grid">
      <article v-for="j in store.visibleJobs" :key="j.sourceId" class="tile">
        <header class="tile__head">
          <span class="monogram tile__mono">{{ initial(j) }}</span>
          <div class="tile__meta">
            <div class="tile__title">{{ j.title || j.url }}</div>
            <div class="tile__sub">{{ subtitle(j) }}</div>
          </div>
          <span class="tile__tag">{{ j.hostname }}</span>
        </header>

        <hr class="hair" />

        <footer class="tile__actions">
          <q-btn unelevated color="primary" no-caps class="col-grow" label="Open" @click="store.openJob(j.url)" />
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
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import type { JobRecord } from 'src/types/models';

const store = useAppStore();

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
  &__actions { display: flex; align-items: stretch; gap: 9px; }
}
.col-grow { flex: 1; }
.dismiss { color: var(--muted); border-color: var(--border-strong); }
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
