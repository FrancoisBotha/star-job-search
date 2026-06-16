<template>
  <div class="screen">
    <div class="head">
      <div>
        <h1 class="page-title">Starred matches</h1>
        <p class="sub">Potential roles Star saved for you. Flag anything off-base and it won't come back.</p>
      </div>
      <q-btn
        v-if="store.dismissedCount > 0"
        outline
        no-caps
        class="restore-btn"
        :label="`Restore ${store.dismissedCount} hidden`"
        @click="store.resetDismissed()"
      />
    </div>

    <div v-if="store.matchCount === 0" class="empty">
      <div class="font-serif empty__title">No starred matches right now</div>
      <p class="empty__sub">Star will add new ones after the next morning scan.</p>
    </div>

    <div class="grid">
      <article v-for="m in store.visibleMatches" :key="m.id" class="tile">
        <header class="tile__head">
          <span class="monogram tile__mono">{{ m.mono }}</span>
          <div class="tile__meta">
            <div class="tile__title">{{ m.role }}</div>
            <div class="tile__sub">{{ m.co }} · {{ m.loc }}</div>
          </div>
          <span class="tile__tag">{{ m.tag }}</span>
        </header>

        <div class="tile__score">
          <StarRating :score="m.score" />
          <span class="font-mono tile__num">{{ m.score.toFixed(1) }}</span>
          <span class="tile__salary">{{ m.salary }}</span>
        </div>

        <div class="tile__why"><span class="star">★</span><span class="why">{{ m.why }}</span></div>

        <hr class="hair" />

        <footer class="tile__actions">
          <q-btn unelevated color="primary" no-caps class="col-grow" label="Open match" @click="goJob" />
          <q-btn outline no-caps class="dismiss" label="Not interested" @click="store.dismissMatch(m.id)" />
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import StarRating from 'components/StarRating.vue';
import { useAppStore } from 'src/stores/app-store';

const store = useAppStore();
const router = useRouter();
const goJob = () => router.push({ name: 'jobdetail' });
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
  // Clamp so dividers/buttons align across tiles regardless of text length
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
  &__score { display: flex; align-items: center; gap: 8px; }
  &__num { font-weight: 600; font-size: 11px; color: var(--text-3); }
  &__salary { margin-left: auto; font: 600 12.5px/1 var(--font-ui); color: var(--text-2); }
  &__why { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; min-height: 16px;
    .star { color: var(--accent); flex-shrink: 0; }
    .why { overflow: hidden; text-overflow: ellipsis; }
  }
  &__actions { display: flex; gap: 9px; }
}
.col-grow { flex: 1; }
.dismiss { color: var(--muted); border-color: var(--border-strong); }
</style>
