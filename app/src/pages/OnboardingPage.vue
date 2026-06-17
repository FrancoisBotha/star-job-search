<template>
  <div class="onb">
    <div class="onb__top">
      <div class="font-serif brand"><span class="brand__star">★</span> Star</div>
      <span class="eyebrow">Setup · step {{ store.onbStep }} of 4</span>
    </div>
    <div class="onb__progress">
      <div class="onb__track">
        <div class="onb__bar" :style="{ width: store.onbProgress + '%' }" />
      </div>
    </div>

    <div class="onb__body app-scroll">
      <div class="onb__inner">
        <!-- Step 1 — Upload CV -->
        <template v-if="store.onbStep === 1">
          <div class="font-serif title">Welcome to Star</div>
          <p class="lead">Upload your CV and Star starts scoring real jobs against your experience — no manual searching.</p>
          <div class="dropzone">
            <div class="dropzone__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c2683a" stroke-width="1.5"><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="15" /></svg>
            </div>
            <div class="dropzone__text">Drag your CV here, or <span class="link">browse files</span></div>
            <div class="dropzone__hint font-mono">PDF or DOCX · max 10MB</div>
          </div>
          <div class="privacy">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
            Your CV stays on this device. Star never uploads it without asking.
          </div>
        </template>

        <!-- Step 2 — Review parsed profile -->
        <template v-else-if="store.onbStep === 2">
          <div class="font-serif title">Here's what Star found</div>
          <p class="lead">Parsed from Alex_Morgan_CV.pdf. Adjust anything — you can edit it later in Profile.</p>
          <div class="grid2">
            <q-input v-model="f.name" outlined dense label="Name" />
            <q-input v-model="f.title" outlined dense label="Current title" />
            <q-input v-model="f.experience" outlined dense label="Experience" />
            <q-input v-model="f.location" outlined dense label="Location" />
          </div>
          <div class="lbl">Top skills</div>
          <div class="skills">
            <span v-for="s in skills" :key="s" class="skill">{{ s }} <span class="skill__x">×</span></span>
          </div>
        </template>

        <!-- Step 3 — Connect AI -->
        <template v-else-if="store.onbStep === 3">
          <div class="font-serif title">Connect your AI</div>
          <p class="lead">Star uses OpenRouter to score jobs and draft tailored CVs &amp; cover letters. Add a key now, or skip and do it later in Settings.</p>
          <div class="eyebrow lbl2">OpenRouter API key</div>
          <q-input v-model="apiKey" outlined dense placeholder="sk-or-v1-…" input-class="font-mono" />
          <div class="hint">Get a key at <span class="link">openrouter.ai/keys</span></div>
          <div class="eyebrow lbl2">Model</div>
          <q-select v-model="model" :options="models" outlined dense />
        </template>

        <!-- Step 4 — Preferences -->
        <template v-else>
          <div class="font-serif title">What are you looking for?</div>
          <p class="lead">Star scans every morning and stars the closest fits.</p>
          <div class="grid2">
            <q-input v-model="pref.role" outlined dense placeholder="e.g. Senior Product Designer" label="Target role" />
            <q-input v-model="pref.salary" outlined dense placeholder="£70,000" label="Minimum salary" />
          </div>
          <div class="lbl">Work mode</div>
          <div class="modes">
            <button v-for="m in modes" :key="m" class="mode" :class="{ 'is-active': pref.mode === m }" @click="pref.mode = m">{{ m }}</button>
          </div>
          <div class="lbl">Sites to scan</div>
          <div class="site-checks">
            <label v-for="s in siteChecks" :key="s.name" class="site-check">
              <q-checkbox v-model="s.on" color="primary" dense />
              {{ s.name }}
            </label>
          </div>
        </template>
      </div>
    </div>

    <div class="onb__footer">
      <q-btn flat no-caps class="skip" label="Skip setup" @click="finish" />
      <div class="onb__nav">
        <q-btn outline no-caps class="ghost" label="Back" @click="store.onbBack()" />
        <q-btn v-if="store.onbStep !== 4" unelevated color="primary" no-caps label="Continue" @click="store.onbNext()" />
        <q-btn v-else unelevated color="primary" no-caps label="Enter Star →" @click="finish" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';
import { PARSED_SKILLS } from 'src/data/sample';

const router = useRouter();
const store = useAppStore();

function finish() {
  store.onbReset();
  void router.push({ name: 'dashboard' });
}

const f = reactive({ name: 'Alex Morgan', title: 'Senior Product Designer', experience: '6 years', location: 'London, UK' });
const skills = PARSED_SKILLS;
const apiKey = ref('');
const model = ref('anthropic/claude-3.5-sonnet');
const models = ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3-opus', 'openai/gpt-4o'];
const pref = reactive({ role: '', salary: '', mode: 'Remote' as 'Remote' | 'Hybrid' | 'On-site' });
const modes: Array<'Remote' | 'Hybrid' | 'On-site'> = ['Remote', 'Hybrid', 'On-site'];
const siteChecks = reactive([
  { name: 'RoleHub', on: true },
  { name: 'Workscout', on: true },
  { name: 'Talentstream', on: true },
]);
</script>

<style scoped lang="scss">
.onb { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }
.onb__top { padding: 22px 30px 0; display: flex; align-items: center; justify-content: space-between; }
.brand { font-size: 24px; display: flex; align-items: center; gap: 8px; }
.brand__star { color: var(--accent); }
.onb__progress { padding: 16px 30px 0; }
.onb__track { height: 3px; border-radius: 2px; background: var(--hair); overflow: hidden; }
.onb__bar { height: 100%; border-radius: 2px; background: var(--accent); transition: width 0.3s; }

.onb__body { flex: 1; display: flex; align-items: flex-start; justify-content: center; padding: 42px 30px; }
.onb__inner { width: 560px; max-width: 100%; }

.title { font-size: 34px; line-height: 1.1; margin-bottom: 8px; }
.lead { font-size: 14.5px; color: var(--text-3); line-height: 1.55; margin: 0 0 26px; }

.dropzone { border: 1.5px dashed var(--border-strong); border-radius: 14px; padding: 42px; text-align: center; background: var(--rail); &:hover { border-color: var(--accent); } }
.dropzone__icon { width: 54px; height: 54px; border-radius: 14px; background: #fff; border: 1px solid var(--input-border); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.dropzone__text { font-size: 15px; font-weight: 600; color: #3a3530; }
.dropzone__hint { font-size: 11px; color: var(--faint); margin-top: 8px; }
.link { color: var(--accent); font-weight: 600; }
.privacy { display: flex; align-items: center; gap: 9px; margin-top: 16px; font-size: 12.5px; color: var(--muted); }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
.lbl { font-size: 13px; font-weight: 600; color: #3a3530; margin-bottom: 10px; }
.lbl2 { margin-bottom: 9px; }
.lbl2:not(:first-child) { margin-top: 18px; }
.hint { font-size: 12px; color: var(--muted); margin-top: 8px; }

.skills { display: flex; flex-wrap: wrap; gap: 7px; }
.skill { display: inline-flex; align-items: center; gap: 6px; font: 500 12.5px/1 var(--font-ui); color: #3a3733; background: var(--accent-tint); padding: 7px 11px; border-radius: 8px; }
.skill__x { color: var(--faint); cursor: pointer; }

.modes { display: flex; gap: 8px; margin-bottom: 18px; }
.mode { font: 600 12.5px/1 var(--font-ui); color: var(--text-2); background: var(--accent-tint); padding: 9px 14px; border-radius: 8px; border: 0; cursor: pointer;
  &.is-active { color: var(--bg); background: var(--text-strong); }
}
.site-checks { display: flex; flex-direction: column; gap: 4px; }
.site-check { display: flex; align-items: center; gap: 4px; font-size: 13.5px; color: #3a3530; }

.onb__footer { padding: 16px 30px; border-top: 1px solid var(--hair); display: flex; align-items: center; justify-content: space-between; }
.skip { color: var(--muted); }
.onb__nav { display: flex; gap: 10px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }
</style>
