<template>
  <div class="discover">
    <!-- embedded browser -->
    <section class="browser">
      <div class="chrome">
        <div class="chrome__nav">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="10 3 5 8 10 13" /></svg>
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="#dcd6c8" stroke-width="1.6"><polyline points="6 3 11 8 6 13" /></svg>
        </div>
        <div class="chrome__url">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#7a8b5a" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
          <span class="font-mono">rolehub.com/search?q=product-designer&amp;remote=true</span>
          <span class="chrome__tag"><span class="scan-dot" />Star browsing</span>
        </div>
      </div>

      <div class="results app-scroll">
        <div class="results__head">
          <div class="font-serif">Product Designer <span class="results__count">· 38 matched of 412 scanned</span></div>
          <span class="font-mono results__sort">sorted by Star score</span>
        </div>

        <article v-for="(m, i) in results" :key="m.id" class="result">
          <span class="monogram monogram--square result__mono">{{ m.mono }}</span>
          <div class="result__body">
            <div class="result__title-row">
              <span class="result__title">{{ m.role }}</span>
              <span v-if="i === 0" class="result__new">NEW</span>
            </div>
            <div class="result__sub">{{ m.co }} · {{ m.loc }} · {{ m.salary }}</div>
            <p class="result__snippet">{{ m.snippet }}</p>
          </div>
          <div class="result__right">
            <StarRating :score="m.score" />
            <span class="font-mono result__fit">{{ m.score.toFixed(1) }} · {{ Math.round((m.score / 5) * 100) }}% fit</span>
            <q-btn
              :unelevated="i === 0"
              :outline="i !== 0"
              color="primary"
              no-caps
              dense
              class="result__cta"
              label="Tailor & apply"
              @click="goJob"
            />
          </div>
        </article>

        <div class="scanning-next"><span class="scan-dot" />Star is scanning Workscout next…</div>
      </div>
    </section>

    <!-- search controls dock -->
    <aside class="dock app-scroll">
      <div class="font-serif dock__title">Search controls</div>
      <p class="dock__lead">Star uses these to steer the automated browser.</p>

      <q-input v-model="role" outlined dense label="Role" class="dock__field" />
      <q-input v-model="location" outlined dense label="Location" class="dock__field" />
      <q-input v-model="salary" outlined dense label="Minimum salary" class="dock__field" />

      <div class="eyebrow dock__label">Sites</div>
      <div class="toggles">
        <div v-for="s in siteToggles" :key="s.name" class="toggle-row">
          <span>{{ s.name }}</span>
          <q-toggle v-model="s.on" color="primary" dense />
        </div>
      </div>

      <q-btn unelevated color="primary" no-caps class="dock__update" label="Update search" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import StarRating from 'components/StarRating.vue';

const router = useRouter();
const goJob = () => router.push({ name: 'jobdetail' });

const role = ref('Product Designer');
const location = ref('Remote · UK / EU');
const salary = ref('£70,000');

const siteToggles = reactive([
  { name: 'RoleHub', on: true },
  { name: 'Workscout', on: true },
  { name: 'Talentstream', on: true },
  { name: 'Hired', on: false },
]);

const results = [
  { id: 'm1', mono: 'N', role: 'Senior Product Designer', co: 'Northwind Studio', loc: 'Remote (UK)', salary: '£75,000–90,000 · posted 6h ago', score: 4.6, snippet: 'Own end-to-end experiences across our payments platform and help scale a growing design system used by every team…' },
  { id: 'm2', mono: 'L', role: 'Lead UX Designer', co: 'Lumen Health', loc: 'Hybrid · Manchester', salary: '£80,000 · posted 1d ago', score: 4.4, snippet: 'Lead UX for a clinical platform, partnering with research and clinicians to ship accessible, evidence-based design…' },
  { id: 'm4', mono: 'A', role: 'Product Designer, Platform', co: 'Atlas Pay', loc: 'Remote (EU)', salary: '€70,000–82,000 · posted 2d ago', score: 4.0, snippet: 'Shape the design system and core flows for a fast-growing payments product across web and mobile…' },
];
</script>

<style scoped lang="scss">
.discover { height: 100%; display: flex; min-width: 0; }
.browser { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }

.chrome {
  height: 48px; flex-shrink: 0; border-bottom: 1px solid var(--hair);
  display: flex; align-items: center; gap: 10px; padding: 0 16px; background: #f7f4ed;
  &__nav { display: flex; gap: 4px; color: var(--faint); }
  &__url {
    flex: 1; display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 13px;
    background: #fff; border: 1px solid #e6e1d4; border-radius: 8px;
    .font-mono { font-size: 12px; color: var(--text-3); }
  }
  &__tag { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 var(--font-mono); color: var(--accent); }
}

.results { flex: 1; padding: 24px 28px; }
.results__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.results__head .font-serif { font-size: 22px; }
.results__count { color: var(--muted); font-size: 15px; font-style: italic; }
.results__sort { font-size: 12px; color: var(--muted); }

.result {
  border: 1px solid var(--hair); border-radius: 11px; padding: 16px 18px; margin-bottom: 11px;
  background: #fff; display: flex; gap: 15px; align-items: flex-start;
  &:hover { border-color: var(--border-strong); }
  &__mono { width: 42px; height: 42px; font-size: 18px; }
  &__body { flex: 1; min-width: 0; }
  &__title-row { display: flex; align-items: center; gap: 8px; }
  &__title { font-size: 16px; font-weight: 700; }
  &__new { font: 500 10px/1 var(--font-mono); color: var(--olive-text); background: var(--olive-tint); padding: 3px 6px; border-radius: 5px; }
  &__sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
  &__snippet { font-size: 13px; color: var(--text-3); line-height: 1.55; margin: 9px 0 0; }
  &__right { text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 9px; }
  &__fit { font-size: 11px; font-weight: 600; color: var(--text-3); }
  &__cta { min-width: 120px; }
}
.scanning-next { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 14px; color: var(--muted); font-size: 12.5px; }

.dock {
  width: 288px; flex-shrink: 0; border-left: 1px solid var(--hair); background: var(--rail); padding: 22px 20px;
  &__title { font-size: 20px; margin-bottom: 4px; }
  &__lead { font-size: 12px; color: var(--muted); margin: 0 0 20px; line-height: 1.5; }
  &__field { margin-bottom: 12px; }
  &__label { margin: 8px 0 11px; }
  &__update { width: 100%; margin-top: 4px; }
}
.toggles { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; color: #3a3530; }
</style>
