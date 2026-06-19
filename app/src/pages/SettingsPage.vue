<template>
  <div class="screen app-scroll">
    <div class="wrap">
      <h1 class="page-title">Settings</h1>
      <p class="sub">Connect an LLM and tune how Star scans and writes.</p>

      <!-- LLM integration -->
      <h2 class="section-title sec">LLM integration</h2>
      <p class="lead">Star uses OpenRouter to score jobs and draft tailored CVs &amp; cover letters. Your key is stored locally and never leaves this device.</p>

      <div class="card">
        <div class="eyebrow lbl">OpenRouter API key</div>

        <!-- Saved-key status row (LLM-005 AC1): shows the masked key on file
             when present, plus a Clear button. The raw key is never echoed
             back from storage — only the masked form supplied by main. -->
        <div v-if="store.apiKeyStatus.present" class="key-status">
          <div class="key-box">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#bcb6a6" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
            <span class="font-mono key-box__val">Key on file · {{ store.apiKeyStatus.masked }}</span>
          </div>
          <q-btn outline no-caps class="ghost" label="Clear" @click="onClear" />
        </div>

        <!-- In-progress input the user is typing. Show/Hide flips the input
             type between password and text — it operates on the local
             `keyDraft` ref ONLY (LLM-005 AC3), never on storage. -->
        <div class="key-row">
          <q-input
            v-model="keyDraft"
            outlined dense
            class="key-row__input"
            :type="keyVisible ? 'text' : 'password'"
            placeholder="sk-or-v1-…"
            autocomplete="off"
          />
          <q-btn outline no-caps class="ghost" :label="keyVisible ? 'Hide' : 'Show'" @click="keyVisible = !keyVisible" />
          <q-btn unelevated color="dark" no-caps label="Save" :disable="!keyDraft.trim()" @click="onSave" />
        </div>
        <div class="hint">Get a key at <span class="link">openrouter.ai/keys</span></div>

        <!-- LLM-006 AC2 — preferred-models list replacing the mock q-select.
             Each row shows the model name, a "Set default" affordance, and
             a Remove button; mutations round-trip through the store/bridges
             so they survive a restart (AC3). The Select-models… button is
             disabled until an API key is saved. -->
        <div class="eyebrow lbl">Preferred models</div>
        <div v-if="store.preferredModels.length === 0" class="prefs-empty">
          No models picked yet. Open the picker to choose up to 5.
        </div>
        <div v-else class="prefs">
          <div v-for="m in store.preferredModels" :key="m.slug" class="prefs__row">
            <div class="prefs__meta">
              <div class="prefs__name">{{ modelLabel(m.slug) }}</div>
              <div class="prefs__slug font-mono">{{ m.slug }}</div>
            </div>
            <span v-if="m.isDefault" class="prefs__default">Default</span>
            <q-btn
              v-else
              outline no-caps dense
              class="prefs__action"
              label="Set default"
              @click="store.setDefaultPreferredModel(m.slug)"
            />
            <q-btn
              outline no-caps dense
              class="prefs__action prefs__action--remove"
              label="Remove"
              @click="store.removePreferredModel(m.slug)"
            />
          </div>
        </div>
        <div class="prefs-actions">
          <q-btn
            unelevated color="dark" no-caps
            label="Select models…"
            :disable="!store.apiKeyStatus.present"
            @click="showPicker = true"
          />
          <span v-if="!store.apiKeyStatus.present" class="prefs-actions__hint">
            Save an OpenRouter key to pick models.
          </span>
        </div>

        <div class="test">
          <q-btn
            unelevated
            color="dark"
            no-caps
            :loading="store.connectionStatus === 'testing'"
            label="Test connection"
            @click="store.testConnection()"
          />
          <span v-if="store.connectionStatus === 'ok'" class="test__ok">
            <span class="test__dot" />Connected · {{ store.connectionModelCount }} models available
          </span>
          <span v-else-if="store.connectionStatus === 'error'" class="test__err">
            <span class="test__dot test__dot--err" />{{ connectionMessage }}
          </span>
        </div>
      </div>

      <!-- Scanning -->
      <h2 class="section-title sec">Scanning</h2>
      <div class="card card--rows">
        <div class="srow">
          <div><div class="srow__title">Auto-scan frequency</div><div class="srow__sub">How often Star searches the sites.</div></div>
          <q-select v-model="frequency" :options="frequencies" outlined dense class="srow__select" />
        </div>
        <div class="srow">
          <div><div class="srow__title">Only notify for ★ 4+ matches</div><div class="srow__sub">Skip the noise; surface the strong fits.</div></div>
          <q-toggle v-model="notifyStrong" color="primary" />
        </div>
        <div class="srow">
          <div><div class="srow__title">Auto-draft cover letters</div><div class="srow__sub">Generate a draft as soon as a match is saved.</div></div>
          <q-toggle v-model="autoDraft" color="primary" />
        </div>
      </div>

      <!-- Job sites -->
      <h2 class="section-title sec">Job sites</h2>
      <p class="lead">The boards Star opens in the embedded browser and scans. Add any site with public listings.</p>
      <div class="card card--rows">
        <div v-for="site in store.sites" :key="site.id" class="site">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#bcb6a6" stroke-width="1.4"><circle cx="8" cy="8" r="6" /><line x1="2" y1="8" x2="14" y2="8" /><path d="M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></svg>
          <span class="font-mono site__url">{{ site.host }}</span>
          <!-- SITEUSR-002 — optional per-site username. Persists on blur /
               Enter via store.setSiteUsername; an empty string clears it. -->
          <q-input
            :model-value="site.username ?? ''"
            outlined dense
            class="site__username"
            placeholder="username (optional)"
            @update:model-value="(v) => store.setSiteUsername(site.id, String(v ?? '').trim())"
          />
          <q-toggle
            :model-value="site.enabled"
            color="primary"
            size="sm"
            class="site__toggle"
            :label="site.enabled ? 'Active' : 'Off'"
            left-label
            @update:model-value="(v) => store.setSiteEnabled(site.id, v)"
          />
          <q-btn outline no-caps dense class="site__remove" label="Remove" @click="store.removeSite(site.id)" />
        </div>
        <div class="site-add">
          <q-input
            v-model="store.siteDraft"
            outlined dense
            class="site-add__input"
            placeholder="add a site — e.g. jobs.example.com"
            @keyup.enter="store.addSite()"
          />
          <q-btn unelevated color="dark" no-caps label="Add site" @click="store.addSite()" />
        </div>
      </div>

      <!-- Backup -->
      <h2 class="section-title sec">Backup</h2>
      <p class="lead">Star automatically saves your profile, CV, applications and settings to a folder you choose.</p>
      <div class="card card--rows">
        <div class="backup">
          <span class="backup__icon">
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="#c2683a" stroke-width="1.4"><path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.6h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /></svg>
          </span>
          <div class="backup__meta">
            <div class="font-mono backup__path">{{ store.backupFolder }}</div>
            <div class="backup__sub">Last backup: today, 08:14 · 2.3 MB</div>
          </div>
          <q-btn outline no-caps class="ghost" label="Choose folder…" />
        </div>
        <div class="srow">
          <div><div class="srow__title">Automatic backups</div><div class="srow__sub">Save after every scan and application update.</div></div>
          <q-toggle v-model="store.autoBackup" color="primary" />
        </div>
      </div>

      <!-- About -->
      <h2 class="section-title sec">About</h2>
      <div class="card card--rows">
        <div class="srow">
          <div>
            <div class="srow__title">Star Job Search</div>
            <div class="srow__sub">Version 0.1.0</div>
          </div>
          <q-btn outline no-caps class="ghost" label="About" @click="showAbout = true" />
        </div>
      </div>

      <q-btn unelevated color="primary" no-caps class="save" label="Save settings" />
    </div>

    <!-- LLM-006 AC1/AC4 — preferred-models picker dialog, styled in the
         same q-dialog visual system as the About dialog below. -->
    <PreferredModelsPickerDialog v-model="showPicker" />

    <!-- About dialog -->
    <q-dialog v-model="showAbout">
      <q-card class="about">
        <div class="about__brand">
          <span class="about__star font-serif">★</span>
          <div>
            <div class="about__name font-serif">Star Job Search</div>
            <div class="about__ver font-mono">Version 0.1.0</div>
          </div>
        </div>
        <p class="about__desc">
          Automated job search with star match scoring, CV &amp; cover-letter tailoring, and
          application tracking.
        </p>
        <div class="about__meta font-mono">Built with Vue 3 · Quasar · Electron</div>
        <div class="about__actions">
          <q-btn v-close-popup unelevated color="primary" no-caps label="Close" />
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import PreferredModelsPickerDialog from 'src/components/PreferredModelsPickerDialog.vue';

const store = useAppStore();

// Local-only state for the in-progress key the user is typing. The raw key
// never round-trips through the store / storage (LLM-005 AC3).
const keyDraft = ref('');
const keyVisible = ref(false);

onMounted(() => {
  // BRWSR-003 AC2/AC5 — persisted Job-sites list.
  void store.hydrateSites();
  // LLM-005 AC1 — pull the masked OpenRouter key status so the row reflects
  // whether a key survived the last restart.
  void store.hydrateApiKeyStatus();
  // LLM-006 AC3 — pull the persisted preferred-models list so the Settings
  // card reflects the choices that survived the last restart.
  void store.hydratePreferredModels();
});

async function onSave() {
  const draft = keyDraft.value.trim();
  if (!draft) return;
  await store.saveApiKey(draft);
  keyDraft.value = '';
  keyVisible.value = false;
}

async function onClear() {
  await store.clearApiKey();
}

// LLM-005 AC2 — branch on the LLM-002 catalogue error codes so the UI shows
// a specific message per code rather than a generic failure string.
const connectionMessage = computed(() => {
  const err = store.connectionError;
  if (!err) return '';
  switch (err.code) {
    case 'NO_API_KEY':
      return 'No API key — save one above and try again.';
    case 'AUTH_ERROR':
      return 'Authentication failed — check your OpenRouter key.';
    case 'RATE_LIMITED':
      return 'Rate limited by OpenRouter — wait a moment and retry.';
    case 'NETWORK_ERROR':
      return 'Network error — could not reach OpenRouter.';
    default:
      return err.message || 'Connection failed.';
  }
});

// LLM-006 AC2 — resolve a slug to the catalogue display name when available,
// falling back to the slug itself when the catalogue hasn't loaded yet.
function modelLabel(slug: string): string {
  const hit = store.models.find((m) => m.id === slug);
  return hit?.name ?? slug;
}

const showPicker = ref(false);
const frequency = ref('Every morning');
const frequencies = ['Every morning', 'Every 6 hours', 'Hourly', 'Manual only'];
const notifyStrong = ref(true);
const autoDraft = ref(false);
const showAbout = ref(false);
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; height: 100%; }
.wrap { max-width: 680px; }
.sub { margin: 7px 0 28px; font-size: 14px; color: var(--text-3); }
.sec { margin: 0 0 6px; }
.sec:not(:first-of-type) { margin-top: 28px; }
.lead { font-size: 13px; color: var(--muted); margin: 0 0 16px; line-height: 1.55; }

.card { border: 1px solid var(--hair); border-radius: 12px; background: #fff; padding: 20px; }
.card--rows { padding: 0; overflow: hidden; }
.lbl { margin-bottom: 9px; }
.lbl:not(:first-child) { margin-top: 18px; }

.key-status { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
.key-row { display: flex; gap: 9px; margin-bottom: 7px; align-items: center; }
.key-row__input { flex: 1; min-width: 0; }
// LLM-009 — `min-width: 0` lets the key-box shrink under flex so a long
// masked value truncates with ellipsis instead of pushing the row wider
// than the API-key entry row below it.
.key-box { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; height: 44px; background: var(--rail); border: 1px solid var(--input-border); border-radius: 9px; padding: 0 13px; }
.key-box__val { flex: 1; min-width: 0; font-size: 13px; color: #3a3530; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.link { color: var(--accent); }
.field { margin-bottom: 4px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }

.prefs { border: 1px solid var(--hair); border-radius: 10px; background: #fff; margin-bottom: 8px; overflow: hidden; }
.prefs__row { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--hair-light); }
.prefs__row:last-child { border-bottom: 0; }
.prefs__meta { flex: 1; min-width: 0; }
.prefs__name { font-size: 13.5px; font-weight: 600; color: #3a3530; }
.prefs__slug { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prefs__default { font: 600 11px/1 var(--font-mono); letter-spacing: 0.04em; color: var(--accent); padding: 4px 8px; border-radius: 6px; background: var(--accent-tint); }
.prefs__action { color: var(--text-2); border-color: var(--hair); }
.prefs__action--remove { color: var(--muted); }
.prefs-empty { font-size: 13px; color: var(--muted); padding: 10px 0 4px; }
.prefs-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.prefs-actions__hint { font-size: 12px; color: var(--muted); }

.test { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.test__ok { display: inline-flex; align-items: center; gap: 7px; font: 600 12.5px/1 var(--font-ui); color: var(--olive-text); }
.test__err { display: inline-flex; align-items: center; gap: 7px; font: 600 12.5px/1.3 var(--font-ui); color: var(--negative); }
.test__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--positive, #3f7a52); }
.test__dot--err { background: var(--negative); }

.srow { display: flex; align-items: center; justify-content: space-between; padding: 15px 18px; border-bottom: 1px solid var(--hair-light); }
.srow:last-child { border-bottom: 0; }
.srow__title { font-size: 14px; font-weight: 600; }
.srow__sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.srow__select { min-width: 170px; }

.site { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--hair-light); }
.site__url { flex: 1; font-size: 13.5px; color: #3a3530; }
.site__username { width: 180px; }
.site__toggle { font-size: 11px; color: var(--text-3); }
.site__remove { color: var(--muted); border-color: var(--hair); }
.site-add { display: flex; align-items: center; gap: 9px; padding: 13px 16px; }
.site-add__input { flex: 1; }

.backup { display: flex; align-items: center; gap: 13px; padding: 16px 18px; border-bottom: 1px solid var(--hair-light); }
.backup__icon { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-tint); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.backup__meta { flex: 1; min-width: 0; }
.backup__path { font-size: 13.5px; color: #3a3530; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.backup__sub { font-size: 12px; color: var(--muted); margin-top: 5px; }

.save { margin-top: 28px; }

.about {
  width: 380px;
  max-width: 90vw;
  padding: 26px;
  border-radius: 16px;
  background: var(--bg);
}
.about__brand { display: flex; align-items: center; gap: 13px; }
.about__star { font-size: 30px; line-height: 1; color: var(--accent); }
.about__name { font-size: 24px; line-height: 1.1; }
.about__ver { font-size: 12px; color: var(--muted); margin-top: 2px; }
.about__desc { font-size: 13px; color: var(--text-2); line-height: 1.55; margin: 18px 0 14px; }
.about__meta { font-size: 11.5px; color: var(--faint); letter-spacing: 0.02em; }
.about__actions { display: flex; justify-content: flex-end; margin-top: 22px; }
</style>
