<template>
  <div class="screen app-scroll">
    <div class="wrap">
      <h1 class="page-title">Profile</h1>
      <p class="sub">This is what Star scores every job against. The more it knows, the sharper your matches.</p>

      <div class="cols">
        <div>
          <!-- CV -->
          <div class="eyebrow lbl">Your CV</div>
          <div class="cv-card">
            <span class="cv-card__icon">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#c2683a" stroke-width="1.4"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="8" x2="10.5" y2="8" /><line x1="5.5" y1="11" x2="8.5" y2="11" /></svg>
            </span>
            <div class="cv-card__meta">
              <div class="cv-card__name">Alex_Morgan_CV.pdf</div>
              <div class="cv-card__sub">Uploaded 3 days ago · parsed successfully</div>
            </div>
            <q-btn outline no-caps class="ghost" label="Replace" />
          </div>
          <div class="dropzone">
            <div class="dropzone__text">Drag a new CV here, or <span class="link">browse files</span></div>
            <div class="dropzone__hint font-mono">PDF, DOCX · max 10MB</div>
          </div>
          <div class="chips">
            <span v-for="c in cvTags" :key="c" class="chip font-mono">{{ c }}</span>
          </div>

          <!-- links -->
          <div class="eyebrow lbl">LinkedIn &amp; web</div>
          <q-input v-model="linkedin" outlined dense class="field" placeholder="https://www.linkedin.com/in/your-handle" label="LinkedIn profile" />
          <q-input v-model="portfolio" outlined dense class="field" placeholder="https://alexmorgan.design" label="Portfolio / personal site" />
          <q-btn flat no-caps class="add-link" label="+ Add link" />

          <!-- preferences -->
          <div class="eyebrow lbl">Target &amp; preferences</div>
          <div class="grid2">
            <q-input v-model="targetRole" outlined dense label="Target role" />
            <q-input v-model="minSalary" outlined dense label="Min. salary" />
          </div>
          <div class="modes">
            <button
              v-for="m in modes"
              :key="m"
              class="mode"
              :class="{ 'is-active': store.workMode === m }"
              @click="store.workMode = m"
            >
              {{ m }}
            </button>
          </div>

          <div class="actions">
            <q-btn unelevated color="primary" no-caps label="Save profile" />
            <q-btn outline no-caps class="ghost" label="Re-scan with new profile" />
          </div>
        </div>

        <!-- right rail -->
        <div class="rail">
          <div class="strength">
            <div class="strength__label">Profile strength</div>
            <div class="strength__num"><span class="font-serif">85</span><span class="font-mono">/100</span></div>
            <q-linear-progress :value="0.85" rounded color="primary" track-color="grey-3" size="5px" class="strength__bar" />
            <div class="checklist">
              <div class="check"><span class="check__done">✓</span> CV uploaded &amp; parsed</div>
              <div class="check"><span class="check__done">✓</span> Preferences set</div>
              <div class="check check--todo"><span class="check__todo">○</span> Add LinkedIn (+10)</div>
              <div class="check check--todo"><span class="check__todo">○</span> Add portfolio (+5)</div>
            </div>
          </div>
          <p class="note">Star never applies on your behalf without confirmation. Your CV and links stay on this device.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import { PARSED_SKILLS } from 'src/data/sample';

const store = useAppStore();
const linkedin = ref('');
const portfolio = ref('');
const targetRole = ref('Senior / Lead Product Designer');
const minSalary = ref('£70,000');
const modes: Array<'Remote' | 'Hybrid' | 'On-site'> = ['Remote', 'Hybrid', 'On-site'];
const cvTags = ['6 yrs experience', '14 skills', 'Design systems', 'Fintech'];
const _skills = PARSED_SKILLS; // available for an editable chips section
void _skills;
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; height: 100%; }
.wrap { max-width: 880px; }
.sub { margin: 7px 0 26px; font-size: 14px; color: var(--text-3); }
.cols { display: grid; grid-template-columns: 1fr 264px; gap: 30px; align-items: start; }
.lbl { margin-bottom: 11px; }

.cv-card { border: 1px solid var(--hair); border-radius: 12px; padding: 16px; background: #fff; display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.cv-card__icon { width: 44px; height: 52px; border-radius: 7px; background: var(--accent-tint); border: 1px solid var(--input-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cv-card__meta { flex: 1; min-width: 0; }
.cv-card__name { font-size: 14px; font-weight: 600; }
.cv-card__sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

.dropzone { border: 1.5px dashed var(--border-strong); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 8px; &:hover { border-color: var(--accent); background: var(--rail); } }
.dropzone__text { font-size: 13px; color: var(--text-3); }
.dropzone__hint { font-size: 11px; color: var(--faint); margin-top: 6px; }
.link { color: var(--accent); font-weight: 600; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 28px; }
.chip { font-size: 11px; color: var(--text-3); background: var(--accent-tint); padding: 5px 9px; border-radius: 6px; }

.field { margin-bottom: 12px; }
.add-link { color: var(--accent); margin: 0 0 28px; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; margin-bottom: 13px; }
.modes { display: flex; gap: 8px; margin-bottom: 28px; }
.mode { font: 600 12.5px/1 var(--font-ui); color: var(--text-2); background: var(--accent-tint); padding: 8px 13px; border-radius: 8px; border: 0; cursor: pointer;
  &.is-active { color: var(--bg); background: var(--text-strong); }
}
.actions { display: flex; gap: 10px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }

.rail { position: sticky; top: 0; }
.strength { border: 1px solid var(--hair); border-radius: 12px; padding: 18px; background: #fff; margin-bottom: 14px; }
.strength__label { font-size: 12.5px; color: var(--text-3); margin-bottom: 10px; }
.strength__num { display: flex; align-items: baseline; gap: 6px; margin-bottom: 12px;
  .font-serif { font-size: 34px; line-height: 1; color: var(--accent); }
  .font-mono { font-size: 12px; color: var(--muted); }
}
.strength__bar { margin-bottom: 14px; }
.checklist { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.check { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
.check--todo { color: var(--muted); }
.check__done { color: var(--olive-text); }
.check__todo { color: #cbb9a0; }
.note { font-size: 12px; color: var(--muted); line-height: 1.6; padding: 0 4px; }
</style>
