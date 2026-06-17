<template>
  <div class="tailor">
    <!-- top bar -->
    <div class="bar">
      <q-btn flat dense no-caps class="bar__back" @click="go('jobdetail')">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 3 5 8 9 13" /></svg>
        Job
      </q-btn>

      <div class="segmented">
        <button class="seg" :class="{ 'is-active': store.tailorTab === 'cv' }" @click="store.tailorTab = 'cv'">Tailored CV</button>
        <button class="seg" :class="{ 'is-active': store.tailorTab === 'letter' }" @click="store.tailorTab = 'letter'">Cover letter</button>
      </div>

      <div class="bar__right">
        <div class="meter">
          <span class="font-mono meter__label">MATCH</span>
          <span class="font-mono meter__from">92%</span>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#5f6b3a" stroke-width="2"><polyline points="3 9 7 13 13 4" /></svg>
          <span class="font-mono meter__to">96%</span>
        </div>
        <q-btn unelevated color="primary" no-caps label="Export PDF" />
      </div>
    </div>

    <div class="tailor__body">
      <!-- document canvas -->
      <div class="canvas app-scroll">
        <!-- CV -->
        <div v-if="store.tailorTab === 'cv'" class="paper">
          <div class="cv__head">
            <div class="font-serif cv__name">Alex Morgan</div>
            <div class="cv__contact">Senior Product Designer · London · alex@morgan.design</div>
          </div>
          <div class="cv__block">
            <span class="cv__label font-mono">Summary</span>
            <p class="cv__p">Product designer with 6 years shipping complex web products. <mark>Specialist in scaling design systems and tokens across multiple squads</mark>, with hands-on <mark>payments platform</mark> experience.</p>
          </div>
          <div class="cv__block">
            <span class="cv__label font-mono">Experience</span>
            <div class="cv__role"><span>Senior Designer · Cedar &amp; Co</span><span class="font-mono cv__dates">2022–now</span></div>
            <ul class="cv__ul"><li><mark>Built a token-driven design system adopted by 5 teams</mark></li><li>Led discovery-to-delivery for two product squads</li></ul>
            <div class="cv__role"><span>Product Designer · Lumen Labs</span><span class="font-mono cv__dates">2020–22</span></div>
            <ul class="cv__ul"><li>Designed onboarding flows that lifted activation 18%</li></ul>
          </div>
          <div class="cv__block">
            <span class="cv__label font-mono">Skills</span>
            <div class="cv__skills">
              <span class="skill">Figma</span>
              <span class="skill">Design systems</span>
              <span class="skill skill--hl">Design tokens</span>
              <span class="skill skill--hl">Fintech</span>
            </div>
          </div>
        </div>

        <!-- Cover letter -->
        <div v-else class="paper letter">
          <div class="font-serif letter__name">Alex Morgan</div>
          <div class="letter__contact">London · alex@morgan.design</div>
          <div class="letter__date">15 June 2026 · Hiring team, Northwind Studio</div>
          <p>Dear Northwind team,</p>
          <p>I'm applying for the <mark>Senior Product Designer</mark> role. Over the past six years I've shipped complex web products end to end, and most recently <mark>built a token-driven design system adopted by five teams</mark> — work that maps directly to the platform and system challenges you describe.</p>
          <p>What draws me to Northwind is the payments focus. I've designed within <mark>regulated, fintech</mark> contexts and care about rigour as much as craft.</p>
          <p>I'd welcome the chance to talk.</p>
          <p>Warm regards,<br />Alex Morgan</p>
        </div>
      </div>

      <!-- suggestions dock -->
      <aside class="dock app-scroll">
        <div class="dock__head">
          <span class="dock__badge">★</span>
          <h4 class="dock__title">Star suggestions</h4>
          <span class="dock__left font-mono">{{ SUGGESTIONS.length }} left</span>
        </div>
        <p class="dock__lead">Accept changes to align with this role — each lifts your match.</p>

        <div class="cards">
          <div v-for="s in SUGGESTIONS" :key="s.text" class="card">
            <div class="card__head">
              <span class="tag" :class="tagClass(s.kind)">{{ s.kind }}</span>
              <span class="gain font-mono">{{ s.gain }}</span>
            </div>
            <p class="card__text" v-html="s.text" />
            <div class="card__actions">
              <q-btn unelevated color="primary" no-caps dense class="col-grow" label="Accept" />
              <q-btn outline no-caps dense class="ghost" label="Dismiss" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import { SUGGESTIONS } from 'src/data/sample';

const router = useRouter();
const store = useAppStore();
const go = (name: string) => router.push({ name });

function tagClass(kind: string) {
  if (kind === 'Reword') return 'tag--olive';
  if (kind === 'Surface gap') return 'tag--gap';
  return 'tag--accent';
}
</script>

<style scoped lang="scss">
.tailor { height: 100%; display: flex; flex-direction: column; }

.bar {
  min-height: 58px; flex-shrink: 0; border-bottom: 1px solid var(--hair);
  display: flex; align-items: center; gap: 16px; padding: 10px 24px; background: var(--rail);
  &__back { color: var(--text-2); border: 1px solid var(--border-strong); border-radius: 8px; height: 32px; gap: 6px; }
  &__right { margin-left: auto; display: flex; align-items: center; gap: 16px; }
}
.meter { display: flex; align-items: center; gap: 8px; }
.meter__label { font-size: 11px; color: var(--muted); }
.meter__from { font-size: 14px; font-weight: 600; color: var(--muted); }
.meter__to { font-size: 14px; font-weight: 600; color: var(--olive-text); }

.tailor__body { flex: 1; display: flex; min-height: 0; }
.canvas { flex: 1; padding: 26px 30px; display: flex; justify-content: center; background: var(--canvas); }

.paper {
  width: 100%; max-width: 540px; height: fit-content;
  background: #fff; border: 1px solid #e6e1d4; border-radius: 6px;
  box-shadow: 0 8px 24px -16px rgba(40, 36, 30, 0.3);
  padding: 40px 44px;
}
mark { background: var(--accent-hl); border-bottom: 1.5px solid var(--accent); padding: 1px 2px; border-radius: 2px; color: inherit; }

.cv__head { border-bottom: 2px solid var(--text); padding-bottom: 14px; margin-bottom: 18px; }
.cv__name { font-size: 28px; line-height: 1; }
.cv__contact { font-size: 12.5px; color: var(--text-3); margin-top: 6px; }
.cv__block { margin-bottom: 18px; }
.cv__label { display: block; font: 700 10px/1 var(--font-mono); letter-spacing: .14em; color: var(--muted); text-transform: uppercase; margin-bottom: 9px; }
.cv__p { font-size: 12.5px; line-height: 1.6; color: #3a3733; margin: 0; }
.cv__role { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 3px; font-size: 13px; font-weight: 700; }
.cv__role:nth-of-type(2) { margin-top: 13px; }
.cv__dates { font-size: 11px; font-weight: 500; color: var(--muted); }
.cv__ul { font-size: 12px; line-height: 1.55; color: #3a3733; margin: 6px 0 0; padding-left: 16px; }
.cv__skills { display: flex; flex-wrap: wrap; gap: 6px; }
.skill { font-size: 11px; background: var(--accent-tint); padding: 4px 9px; border-radius: 6px; color: #3a3733; }
.skill--hl { background: var(--accent-hl); color: #9a5a26; border: 1px solid #e6c4a8; }

.letter { font-size: 13px; line-height: 1.75; color: #3a3733; padding: 44px 46px; }
.letter p { margin: 0 0 14px; }
.letter__name { font-size: 23px; line-height: 1; }
.letter__contact { font-size: 12px; color: var(--muted); margin: 5px 0 22px; }
.letter__date { font-size: 12px; color: var(--muted); margin-bottom: 20px; }

.dock {
  width: 322px; flex-shrink: 0; border-left: 1px solid var(--hair); background: var(--rail);
  &__head { display: flex; align-items: center; gap: 7px; padding: 18px 18px 6px; }
  &__badge { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; }
  &__title { margin: 0; font-size: 13.5px; font-weight: 700; }
  &__left { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--accent-tint); color: var(--accent-hover); padding: 4px 7px; border-radius: 6px; }
  &__lead { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.45; padding: 0 18px 14px; border-bottom: 1px solid var(--hair); }
}
.cards { padding: 14px; display: flex; flex-direction: column; gap: 11px; }
.card { border: 1px solid var(--hair); background: #fff; border-radius: 11px; padding: 13px; }
.card__head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.tag { font: 600 10px/1 var(--font-mono); padding: 3px 7px; border-radius: 5px; text-transform: uppercase; letter-spacing: .05em; }
.tag--accent { background: var(--accent-tint); color: var(--accent-hover); }
.tag--olive { background: var(--olive-tint); color: var(--olive-text); }
.tag--gap { background: #f7e9e4; color: var(--accent-hover); }
.gain { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--olive-text); }
.card__text { margin: 0 0 11px; font-size: 12.5px; line-height: 1.5; color: #3a3733; }
.card__actions { display: flex; gap: 7px; }
.col-grow { flex: 1; }
.ghost { color: var(--muted); border-color: var(--input-border); }
</style>
