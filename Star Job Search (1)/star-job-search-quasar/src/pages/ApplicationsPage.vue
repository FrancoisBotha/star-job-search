<template>
  <div class="screen">
    <div class="head">
      <div>
        <h1 class="page-title">Applications</h1>
        <p class="sub">Every role you've saved or applied to, tracked end to end.</p>
      </div>
      <q-btn outline no-caps class="ghost" label="Export CSV" />
    </div>

    <div class="stat-strip stats">
      <div><div class="stat-label">Total</div><div class="stat-num">14</div></div>
      <div><div class="stat-label">Interviewing</div><div class="stat-num" style="color: var(--olive-text)">3</div></div>
      <div><div class="stat-label">Offers</div><div class="stat-num" style="color: #3f7a52">1</div></div>
      <div><div class="stat-label">Response rate</div><div class="stat-num" style="color: var(--accent)">36%</div></div>
    </div>

    <!-- filter tabs -->
    <div class="segmented filters">
      <button
        v-for="f in filters"
        :key="f"
        class="seg"
        :class="{ 'is-active': store.filter === f }"
        @click="store.setFilter(f)"
      >
        {{ f }}
      </button>
    </div>

    <!-- table -->
    <div class="thead">
      <span class="font-mono col">Role</span>
      <span class="font-mono col">Score</span>
      <span class="font-mono col">Status</span>
      <span class="font-mono col">Applied</span>
      <span class="font-mono col col--right">Updated</span>
    </div>

    <div
      v-for="(a, i) in rows"
      :key="i"
      class="row"
      @click="goJob"
    >
      <div class="role">
        <span class="monogram role__mono">{{ a.mono }}</span>
        <div class="role__meta">
          <div class="role__title">{{ a.role }}</div>
          <div class="role__sub">{{ a.co }} · {{ a.loc }}</div>
        </div>
      </div>
      <div class="score">
        <StarRating :score="a.score" :size="12" :gap="1.5" />
        <span class="font-mono score__num">{{ a.score.toFixed(1) }}</span>
      </div>
      <div><StatusPill :status="a.status" /></div>
      <div class="font-mono cell-muted">{{ a.applied }}</div>
      <div class="font-mono cell-faint col--right">{{ a.updated }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import StarRating from 'components/StarRating.vue';
import StatusPill from 'components/StatusPill.vue';
import { useAppStore, type AppFilter } from 'src/stores/app-store';
import { APPLICATIONS } from 'src/data/sample';

const store = useAppStore();
const router = useRouter();
const goJob = () => router.push({ name: 'jobdetail' });

const filters: AppFilter[] = ['All', 'Applied', 'Interviewing', 'Offer'];
const rows = computed(() =>
  store.filter === 'All' ? APPLICATIONS : APPLICATIONS.filter((a) => a.status === store.filter),
);
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.sub { margin: 7px 0 0; font-size: 14px; color: var(--text-3); }
.ghost { color: var(--text-2); border-color: var(--border-strong); }
.stats { margin-bottom: 22px; grid-template-columns: repeat(4, 1fr); }
.filters { margin-bottom: 8px; }

.thead {
  display: grid; grid-template-columns: 2.4fr 1fr 1.1fr 0.9fr 0.9fr; gap: 14px;
  padding: 10px 12px; border-bottom: 1px solid var(--hair);
}
.col { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); font-weight: 600; }
.col--right { text-align: right; }

.row {
  display: grid; grid-template-columns: 2.4fr 1fr 1.1fr 0.9fr 0.9fr; gap: 14px;
  padding: 14px 12px; border-bottom: 1px solid var(--hair); align-items: center; cursor: pointer;
  &:hover { background: var(--rail); }
}
.role { display: flex; align-items: center; gap: 12px; min-width: 0; }
.role__mono { width: 34px; height: 34px; font-size: 14px; }
.role__meta { min-width: 0; }
.role__title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.role__sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.score { display: flex; align-items: center; gap: 7px; }
.score__num { font-size: 11px; font-weight: 500; color: var(--text-3); }
.cell-muted { font-size: 12.5px; font-weight: 500; color: var(--text-3); }
.cell-faint { font-size: 12.5px; font-weight: 500; color: var(--muted); }
</style>
