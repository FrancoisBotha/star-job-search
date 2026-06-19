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

          <input
            ref="fileInput"
            type="file"
            accept=".pdf,.docx"
            class="file-hidden"
            @change="onFileInputChange"
          />

          <div
            class="dropzone"
            :class="{ 'is-busy': isBusy }"
            @dragover.prevent="onDragOver"
            @drop.prevent="onDrop"
          >
            <div class="dropzone__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c2683a" stroke-width="1.5"><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="15" /></svg>
            </div>
            <div class="dropzone__text">
              Drag your CV here, or
              <span class="link" role="button" @click="pickFile">browse files</span>
            </div>
            <div class="dropzone__hint font-mono">PDF or DOCX · max 10MB</div>
          </div>

          <div v-if="fileError" class="error" role="alert">
            {{ fileError }}
          </div>

          <div v-if="isBusy" class="progress">
            <q-spinner color="primary" size="16px" />
            <span>{{ progressText }}</span>
          </div>

          <div v-if="store.cvParseStatus === 'error'" class="error" role="alert">
            We couldn't parse that CV. {{ store.cvParseError || '' }}
            <div class="fallback">
              <q-btn flat no-caps class="link-btn" label="Retry" @click="retryStructure" />
              <q-btn flat no-caps class="link-btn" label="Upload a different file" @click="pickFile" />
              <q-btn flat no-caps class="link-btn" label="Enter manually" @click="enterManually" />
            </div>
          </div>

          <div v-if="!store.apiKeyStatus.present" class="hint">
            No AI key yet — you can <span class="link" role="button" @click="enterManually">enter your profile manually</span>
            and add a key later in Settings.
          </div>

          <div class="privacy">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
            Your CV stays on this device. Star never uploads it without asking.
          </div>
        </template>

        <!-- Step 2 — Review parsed profile -->
        <template v-else-if="store.onbStep === 2">
          <div class="font-serif title">Here's what Star found</div>
          <p class="lead">
            <template v-if="manualEntry">Enter your profile — you can refine it later in Profile.</template>
            <template v-else-if="store.currentCv">Parsed from {{ store.currentCv.fileName }}. Adjust anything — you can edit it later in Profile.</template>
            <template v-else>Adjust anything — you can edit it later in Profile.</template>
          </p>

          <div class="grid2">
            <q-input
              v-model="f.name"
              outlined
              dense
              label="Name"
              :class="{ 'field--low-confidence': isLowConfidence('name') }"
              :hint="isLowConfidence('name') ? 'Low confidence — please confirm' : ''"
            />
            <q-input
              v-model="f.targetRole"
              outlined
              dense
              label="Current / target role"
              :class="{ 'field--low-confidence': isLowConfidence('targetRole') }"
              :hint="isLowConfidence('targetRole') ? 'Low confidence — please confirm' : ''"
            />
            <q-input
              v-model.number="f.yearsExperience"
              type="number"
              outlined
              dense
              label="Years experience"
              :class="{ 'field--low-confidence': isLowConfidence('totalYearsExperience') }"
              :hint="isLowConfidence('totalYearsExperience') ? 'Low confidence — please confirm' : ''"
            />
            <q-input
              v-model="f.location"
              outlined
              dense
              label="Location"
              :class="{ 'field--low-confidence': isLowConfidence('location') }"
              :hint="isLowConfidence('location') ? 'Low confidence — please confirm' : ''"
            />
          </div>

          <div class="lbl">Top skills</div>
          <div class="skills">
            <span v-for="s in skills" :key="s" class="skill">
              {{ s }}
              <span class="skill__x" role="button" @click="removeSkill(s)">×</span>
            </span>
            <q-input
              v-model="skillDraft"
              outlined
              dense
              class="skill-input"
              placeholder="Add a skill"
              @keyup.enter="addSkill"
            />
          </div>

          <div v-if="store.cvParseStatus === 'error' && !manualEntry" class="error" role="alert">
            Structuring failed.
            <div class="fallback">
              <q-btn flat no-caps class="link-btn" label="Retry" @click="retryStructure" />
              <q-btn flat no-caps class="link-btn" label="Upload a different file" @click="backToUpload" />
              <q-btn flat no-caps class="link-btn" label="Enter manually" @click="enterManually" />
            </div>
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
        <q-btn
          v-if="store.onbStep === 2"
          unelevated
          color="primary"
          no-caps
          label="Confirm &amp; continue"
          @click="confirmReview"
        />
        <q-btn
          v-else-if="store.onbStep !== 4"
          unelevated
          color="primary"
          no-caps
          label="Continue"
          @click="store.onbNext()"
        />
        <q-btn v-else unelevated color="primary" no-caps label="Enter Star →" @click="finish" />
      </div>
    </div>

    <!-- One-time "what is sent" disclosure (FR-011). Shown before the first
         CV text is sent to the OpenRouter model. -->
    <q-dialog v-model="showDisclosure" persistent>
      <q-card class="disclosure">
        <div class="disclosure__title font-serif">What we send to your AI provider</div>
        <p class="disclosure__body">
          Star will send the <strong>plain text</strong> extracted from your CV to your
          configured OpenRouter model so it can structure it into profile fields. The
          original PDF/DOCX file stays on this device. Nothing else is sent.
        </p>
        <p class="disclosure__body">
          This is the only time Star sends your CV text without an explicit per-call confirmation.
        </p>
        <div class="disclosure__actions">
          <q-btn v-close-popup flat no-caps label="Cancel" @click="cancelDisclosure" />
          <q-btn v-close-popup unelevated color="primary" no-caps label="Send &amp; continue" @click="acknowledgeDisclosure" />
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';

const router = useRouter();
const store = useAppStore();

const fileInput = ref<HTMLInputElement | null>(null);
const fileError = ref<string | null>(null);
const manualEntry = ref(false);
const showDisclosure = ref(false);
const disclosureAcknowledged = ref(false);
const skillDraft = ref('');

const DISCLOSURE_KEY = 'star.cvDisclosure.ack.v1';
const LOW_CONFIDENCE_THRESHOLD = 0.7;
const MAX_BYTES = 10 * 1024 * 1024;

const f = reactive({
  name: '',
  targetRole: '',
  yearsExperience: null as number | null,
  location: '',
});
const skills = ref<string[]>([]);

const pendingFile = ref<File | null>(null);

const isBusy = computed(
  () => store.cvParseStatus === 'extracting' || store.cvParseStatus === 'structuring',
);
const progressText = computed(() => {
  if (store.cvParseStatus === 'extracting') return 'Reading your CV…';
  if (store.cvParseStatus === 'structuring') return 'Structuring with your AI provider…';
  return '';
});

function isLowConfidence(field: string): boolean {
  const parsed = store.currentCv?.parsedFields as
    | { confidence?: { perField?: Record<string, number> } }
    | null
    | undefined;
  const perField = parsed?.confidence?.perField ?? null;
  if (!perField) return false;
  const value = perField[field];
  return typeof value === 'number' && value < LOW_CONFIDENCE_THRESHOLD;
}

onMounted(async () => {
  try {
    disclosureAcknowledged.value = window.localStorage?.getItem(DISCLOSURE_KEY) === '1';
  } catch {
    disclosureAcknowledged.value = false;
  }
  await store.hydrateApiKeyStatus();
  await store.loadProfile();
  await store.listCvs();
  hydrateFormFromStore();
});

watch(
  () => store.currentCv?.id,
  () => hydrateFormFromStore(),
);

function hydrateFormFromStore() {
  const parsed = store.currentCv?.parsedFields as
    | {
        name?: string | null;
        targetRole?: string | null;
        location?: string | null;
        totalYearsExperience?: number | null;
        skills?: string[];
      }
    | null
    | undefined;
  if (parsed) {
    f.name = parsed.name ?? f.name;
    f.targetRole = parsed.targetRole ?? f.targetRole;
    f.location = parsed.location ?? f.location;
    if (typeof parsed.totalYearsExperience === 'number') {
      f.yearsExperience = parsed.totalYearsExperience;
    }
    if (Array.isArray(parsed.skills) && parsed.skills.length) {
      skills.value = [...parsed.skills];
    }
  } else if (store.profile) {
    f.name = store.profile.name || f.name;
    f.targetRole = store.profile.targetRole || f.targetRole;
    f.location = store.profile.location || f.location;
    if (store.profile.yearsExperience !== null) {
      f.yearsExperience = store.profile.yearsExperience;
    }
    if (store.profile.skills.length) skills.value = [...store.profile.skills];
  }
}

function pickFile() {
  fileError.value = null;
  fileInput.value?.click();
}

function onFileInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (file) void handleFile(file);
  input.value = '';
}

function onDragOver(_ev: DragEvent) {
  // no-op — preventDefault handled by the @dragover.prevent modifier
}

function onDrop(ev: DragEvent) {
  const file = ev.dataTransfer?.files?.[0] ?? null;
  if (file) void handleFile(file);
}

function detectMime(file: File): 'pdf' | 'docx' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  return null;
}

async function handleFile(file: File) {
  fileError.value = null;
  const mime = detectMime(file);
  if (!mime) {
    fileError.value = 'Only PDF and DOCX files are supported. Please choose a .pdf or .docx file.';
    return;
  }
  if (file.size > MAX_BYTES) {
    fileError.value = 'That file is over the 10MB limit. Please choose a smaller CV.';
    return;
  }
  pendingFile.value = file;

  if (!store.apiKeyStatus.present) {
    // No key — upload + extract still works, but structuring will not.
    // Surface the manual-entry fallback prominently.
    await uploadOnly(file, mime);
    return;
  }

  if (!disclosureAcknowledged.value) {
    showDisclosure.value = true;
    return;
  }

  await runUploadAndStructure(file, mime);
}

// Electron 32 removed the File.path property. The absolute filesystem
// path comes from the preload-exposed webUtils.getPathForFile bridge
// (CVPROF-011) — never the bare file name, which would hand the main
// process a filename with no directory and break the userData copy.
// Empty path → user-facing error, no cv:upload call.
function resolveFilePath(file: File): string {
  return window.starFile?.getPathForFile(file) ?? '';
}

async function uploadOnly(file: File, mime: 'pdf' | 'docx') {
  const filePath = resolveFilePath(file);
  if (!filePath) {
    fileError.value = 'Could not resolve the CV file path. Try the file picker.';
    return;
  }
  const cv = await store.uploadCv({ filePath, fileName: file.name, mime });
  if (cv) hydrateFormFromStore();
}

async function runUploadAndStructure(file: File, mime: 'pdf' | 'docx') {
  const filePath = resolveFilePath(file);
  if (!filePath) {
    fileError.value = 'Could not resolve the CV file path. Try the file picker.';
    return;
  }
  const cv = await store.uploadCv({ filePath, fileName: file.name, mime });
  if (!cv) {
    fileError.value = 'Upload failed. Please try a different file.';
    return;
  }
  const result = await store.structureCv(cv.parsedText || '');
  if (result?.ok) {
    hydrateFormFromStore();
    manualEntry.value = false;
    store.onbStep = 2;
  }
}

function cancelDisclosure() {
  showDisclosure.value = false;
  pendingFile.value = null;
}

async function acknowledgeDisclosure() {
  showDisclosure.value = false;
  disclosureAcknowledged.value = true;
  try {
    window.localStorage?.setItem(DISCLOSURE_KEY, '1');
  } catch {
    /* ignore */
  }
  const file = pendingFile.value;
  if (!file) return;
  const mime = detectMime(file);
  if (!mime) return;
  await runUploadAndStructure(file, mime);
}

function retryStructure() {
  const file = pendingFile.value;
  if (!file) return;
  const mime = detectMime(file);
  if (!mime) return;
  void runUploadAndStructure(file, mime);
}

function backToUpload() {
  store.onbStep = 1;
}

function enterManually() {
  manualEntry.value = true;
  hydrateFormFromStore();
  store.onbStep = 2;
}

function removeSkill(skill: string) {
  skills.value = skills.value.filter((s) => s !== skill);
}

function addSkill() {
  const value = skillDraft.value.trim();
  if (!value) return;
  if (!skills.value.includes(value)) skills.value.push(value);
  skillDraft.value = '';
}

async function confirmReview() {
  await store.saveProfile({
    name: f.name.trim(),
    targetRole: f.targetRole.trim(),
    yearsExperience: f.yearsExperience,
    location: f.location.trim(),
    skills: [...skills.value],
  });
  store.onbNext();
}

function finish() {
  store.onbReset();
  void router.push({ name: 'dashboard' });
}

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

.file-hidden { display: none; }

.dropzone { border: 1.5px dashed var(--border-strong); border-radius: 14px; padding: 42px; text-align: center; background: var(--rail); cursor: pointer;
  &:hover { border-color: var(--accent); }
  &.is-busy { opacity: 0.7; pointer-events: none; }
}
.dropzone__icon { width: 54px; height: 54px; border-radius: 14px; background: #fff; border: 1px solid var(--input-border); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.dropzone__text { font-size: 15px; font-weight: 600; color: #3a3530; }
.dropzone__hint { font-size: 11px; color: var(--faint); margin-top: 8px; }
.link { color: var(--accent); font-weight: 600; cursor: pointer; }
.link-btn { color: var(--accent); }
.privacy { display: flex; align-items: center; gap: 9px; margin-top: 16px; font-size: 12.5px; color: var(--muted); }

.progress { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: var(--text-3); }
.error { margin-top: 12px; font-size: 13px; color: #b04420; }
.fallback { display: flex; gap: 6px; margin-top: 6px; }

.field--low-confidence :deep(.q-field__control) {
  border-color: #d09850;
}

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
.lbl { font-size: 13px; font-weight: 600; color: #3a3530; margin-bottom: 10px; }
.lbl2 { margin-bottom: 9px; }
.lbl2:not(:first-child) { margin-top: 18px; }
.hint { font-size: 12px; color: var(--muted); margin-top: 8px; }

.skills { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.skill { display: inline-flex; align-items: center; gap: 6px; font: 500 12.5px/1 var(--font-ui); color: #3a3733; background: var(--accent-tint); padding: 7px 11px; border-radius: 8px; }
.skill__x { color: var(--faint); cursor: pointer; }
.skill-input { min-width: 140px; }

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

.disclosure { padding: 22px; max-width: 460px; }
.disclosure__title { font-size: 20px; margin-bottom: 10px; }
.disclosure__body { font-size: 13.5px; color: var(--text-3); line-height: 1.55; margin: 0 0 12px; }
.disclosure__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
</style>
