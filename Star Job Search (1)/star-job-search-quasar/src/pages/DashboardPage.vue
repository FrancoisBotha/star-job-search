<template>
  <div class="screen">
    <!-- header -->
    <div class="head">
      <div>
        <div class="font-serif greeting">Good morning, Alex</div>
        <p class="sub">
          12 new matches found overnight —
          <span class="font-serif accent-em">4 worth a closer look.</span>
        </p>
      </div>
      <div class="head__actions">
        <span class="scanning"><span class="scan-dot" />Scanning 4 sites</span>
        <q-btn unelevated color="primary" label="Run scan" no-caps />
      </div>
    </div>

    <!-- stat strip -->
    <div class="stat-strip stats">
      <div v-for="s in stats" :key="s.label">
        <div class="stat-label">{{ s.label }}</div>
        <div class="stat-num" :style="s.accent ? { color: 'var(--accent)' } : undefined">{{ s.value }}</div>
      </div>
    </div>

    <!-- two columns -->
    <div class="cols">
      <div>
        <div class="eyebrow" style="margin-bottom: 6px">Top matches today</div>
        <div
          v-for="m in topMatches"
          :key="m.id"
          class="match-row"
          @click="goJob"
        >
          <span class="monogram match-row__mono">{{ m.mono }}</span>
          <div class="match-row__meta">
            <div class="match-row__title">{{ m.role }}</div>
            <div class="match-row__sub">{{ m.co }} · {{ m.loc }} · {{ m.salary }}</div>
          </div>
          <StarRating :score="m.score" />
          <q-btn flat dense no-caps class="open-btn" label="Open" @click.stop="goJob" />
        </div>
      </div>

      <div>
        <div class="eyebrow" style="margin-bottom: 14px">Live scan</div>
        <div class="scan-list">
          <div v-for="src in sources" :key="src.name" class="scan">
            <div class="scan__head">
              <span>{{ src.name }}</span>
              <span class="font-serif" :style="{ color: src.state === 'queued' ? 'var(--faint)' : 'var(--text-3)' }">{{ src.count }}</span>
            </div>
            <div class="scan__track">
              <div
                class="scan__fill"
                :style="{ width: src.progress + '%', background: src.state === 'done' ? 'var(--olive)' : src.state === 'queued' ? '#d9d4c6' : 'var(--accent)' }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import StarRating from 'components/StarRating.vue';
import { MATCHES, SCAN_SOURCES } from 'src/data/sample';

const router = useRouter();
const goJob = () => router.push({ name: 'jobdetail' });

const stats = [
  { label: 'Scanned', value: '1,482', accent: false },
  { label: 'Strong', value: '38', accent: true },
  { label: 'Applied', value: '14', accent: false },
  { label: 'Interviews', value: '3', accent: false },
];
const topMatches = MATCHES.slice(0, 3);
const sources = SCAN_SOURCES;
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
.greeting { font-size: 36px; line-height: 1.05; letter-spacing: -0.01em; }
.sub { margin: 8px 0 0; font-size: 14px; color: var(--text-3); }
.accent-em { font-style: italic; font-size: 16px; color: var(--accent); }
.head__actions { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
.scanning { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-3); }

.stats { margin-bottom: 30px; grid-template-columns: repeat(4, 1fr); }

.cols { display: grid; grid-template-columns: 1.6fr 1fr; gap: 40px; }

.match-row {
  display: flex; align-items: center; gap: 14px;
  padding: 15px 0; border-bottom: 1px solid var(--hair);
  cursor: pointer;
  &__mono { width: 38px; height: 38px; font-size: 16px; }
  &__meta { flex: 1; min-width: 0; }
  &__title { font-size: 15px; font-weight: 600; }
  &__sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
}
.open-btn { color: var(--accent); border: 1px solid var(--border-strong); border-radius: 7px; height: 30px; }

.scan-list { display: flex; flex-direction: column; gap: 15px; }
.scan__head { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-2); margin-bottom: 7px; }
.scan__track { height: 2px; background: var(--hair); }
.scan__fill { height: 100%; }
</style>
