<template>
  <div class="job">
    <!-- breadcrumb bar -->
    <div class="crumb">
      <q-btn flat dense no-caps class="crumb__back" @click="go('discover')">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 3 5 8 9 13" /></svg>
        Discover
      </q-btn>
      <span class="crumb__sep">/</span>
      <span class="crumb__here">Senior Product Designer</span>
      <span class="crumb__url font-mono">rolehub.com</span>
    </div>

    <div class="job__body">
      <!-- posting -->
      <div class="posting app-scroll">
        <div class="posting__inner">
          <div class="posting__head">
            <span class="monogram monogram--square posting__mono">N</span>
            <div>
              <div class="posting__co">Northwind Studio · Design</div>
              <div class="font-serif posting__title">Senior Product Designer</div>
            </div>
          </div>
          <div class="chips">
            <span v-for="c in chips" :key="c" class="chip">{{ c }}</span>
          </div>

          <h3 class="h3">About the role</h3>
          <p class="p">We're looking for a senior product designer to own end-to-end experiences across our payments platform. You'll partner with product and engineering to ship work that's both rigorous and beautiful, and help shape a growing design system used by every team.</p>

          <h3 class="h3">What you'll do</h3>
          <ul class="ul">
            <li>Lead design for two product squads, from discovery through delivery</li>
            <li>Evolve and maintain our component library and design tokens</li>
            <li>Run usability sessions and translate findings into iterations</li>
            <li>Mentor mid-level designers and raise the craft bar across the team</li>
          </ul>

          <h3 class="h3">What we're looking for</h3>
          <ul class="ul">
            <li>5+ years designing complex web products</li>
            <li>Strong systems thinking and Figma fluency</li>
            <li>Experience with design systems at scale</li>
            <li>Bonus: fintech or regulated-industry background</li>
          </ul>
        </div>
      </div>

      <!-- star match dock -->
      <aside class="dock app-scroll">
        <div class="eyebrow dock__eyebrow">Star match</div>
        <div class="dock__score">
          <div class="font-serif dock__big">4.6</div>
          <div>
            <StarRating :score="4.6" :size="17" :gap="3" />
            <div class="font-mono dock__fit">92% profile fit</div>
          </div>
        </div>

        <h4 class="h4">Score breakdown</h4>
        <div class="bars">
          <ScoreBar v-for="b in breakdown" :key="b.label" :label="b.label" :value="b.value" :good="b.good" />
        </div>

        <h4 class="h4">Why it matches</h4>
        <div class="reasons">
          <div v-for="r in reasons" :key="r" class="reason"><span class="reason__tick">✓</span><span>{{ r }}</span></div>
        </div>

        <h4 class="h4">One gap to address</h4>
        <div class="reason"><span class="reason__warn">!</span><span>Fintech isn't labelled on your CV — Star can surface your payments project.</span></div>

        <div class="dock__actions">
          <q-btn unelevated color="primary" no-caps class="full" label="Tailor CV & cover letter" @click="go('tailor')" />
          <div class="dock__row">
            <q-btn outline no-caps class="ghost col-grow" label="Save" />
            <q-btn outline no-caps class="ghost col-grow" label="Apply direct" />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import StarRating from 'components/StarRating.vue';
import ScoreBar from 'components/ScoreBar.vue';
import { SCORE_BREAKDOWN } from 'src/data/sample';

const router = useRouter();
const go = (name: string) => router.push({ name });

const chips = ['Remote · UK', '£75,000–90,000', 'Full-time', 'Posted 6h ago'];
const breakdown = SCORE_BREAKDOWN;
const reasons = [
  'Your design-system work maps directly to their token system',
  '6 years clears their 5+ requirement comfortably',
  'Remote-UK matches your saved preferences',
];
</script>

<style scoped lang="scss">
.job { height: 100%; display: flex; flex-direction: column; }

.crumb {
  height: 50px; flex-shrink: 0; border-bottom: 1px solid var(--hair);
  display: flex; align-items: center; gap: 12px; padding: 0 24px; background: var(--rail);
  &__back { color: var(--text-2); border: 1px solid var(--border-strong); border-radius: 7px; height: 30px; gap: 6px; }
  &__sep { color: #cbc4b4; }
  &__here { font-size: 13px; font-weight: 600; color: #3a3530; }
  &__url { margin-left: auto; font-size: 12px; color: var(--muted); }
}

.job__body { flex: 1; display: flex; min-height: 0; }
.posting { flex: 1; min-width: 0; padding: 30px 36px; }
.posting__inner { max-width: 600px; }
.posting__head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.posting__mono { width: 50px; height: 50px; border-radius: 12px; font-size: 20px; }
.posting__co { font-size: 13px; color: var(--muted); }
.posting__title { font-size: 27px; line-height: 1.1; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 26px; }
.chip { font: 500 12px/1 var(--font-ui); color: var(--text-2); background: #fff; border: 1px solid #e6e1d4; padding: 7px 11px; border-radius: 7px; }

.h3 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
.p { font-size: 14px; line-height: 1.65; color: #54504a; margin: 0 0 20px; text-wrap: pretty; }
.ul { font-size: 14px; line-height: 1.7; color: #54504a; margin: 0 0 20px; padding-left: 18px; }

.dock {
  width: 332px; flex-shrink: 0; border-left: 1px solid var(--hair); background: var(--rail);
  padding: 24px 22px; display: flex; flex-direction: column;
  &__eyebrow { color: var(--accent); margin-bottom: 14px; }
  &__score { display: flex; align-items: flex-end; gap: 13px; margin-bottom: 22px; }
  &__big { font-size: 50px; line-height: 0.82; }
  &__fit { font-size: 12px; font-weight: 600; color: var(--olive-text); margin-top: 6px; }
  &__actions { margin-top: auto; display: flex; flex-direction: column; gap: 9px; padding-top: 16px; }
  &__row { display: flex; gap: 9px; }
}
.h4 { margin: 0 0 13px; font-size: 13px; font-weight: 700; }
.bars { display: flex; flex-direction: column; gap: 11px; margin-bottom: 20px; }
.reasons { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.reason { display: flex; gap: 9px; font-size: 12.5px; color: #54504a; line-height: 1.45; }
.reason__tick { color: var(--olive-text); flex-shrink: 0; }
.reason__warn { color: var(--accent); flex-shrink: 0; }
.full { width: 100%; }
.col-grow { flex: 1; }
.ghost { color: var(--text-2); border-color: var(--input-border); }
</style>
