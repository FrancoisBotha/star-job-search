<template>
  <div class="screen app-scroll">
    <div class="wrap">
      <h1 class="page-title">Profile</h1>
      <p class="sub">This is what Star scores every job against. The more it knows, the sharper your matches.</p>

      <div class="cols">
        <div>
          <!-- CV -->
          <div class="eyebrow lbl">Your CV</div>
          <div v-if="store.currentCv" class="cv-card">
            <span class="cv-card__icon">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#c2683a" stroke-width="1.4"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="8" x2="10.5" y2="8" /><line x1="5.5" y1="11" x2="8.5" y2="11" /></svg>
            </span>
            <div class="cv-card__meta">
              <div class="cv-card__name">{{ store.currentCv.fileName }}</div>
              <div class="cv-card__sub">Uploaded {{ formatUploadedAt(store.currentCv.uploadedAt) }} · {{ parseStatusLabel }}</div>
            </div>
            <div class="cv-card__actions">
              <q-btn outline no-caps class="ghost" label="Replace" @click="openPicker" />
              <q-btn
                outline
                no-caps
                class="ghost cv-card__clear"
                label="Clear"
                :disable="isUploadBusy"
                @click="openClearConfirm"
              />
            </div>
          </div>
          <div v-else class="cv-card">
            <span class="cv-card__icon">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#c2683a" stroke-width="1.4"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="8" x2="10.5" y2="8" /><line x1="5.5" y1="11" x2="8.5" y2="11" /></svg>
            </span>
            <div class="cv-card__meta">
              <div class="cv-card__name">No CV uploaded yet</div>
              <div class="cv-card__sub">Add a PDF or DOCX so Star can score jobs against your real experience.</div>
            </div>
            <q-btn outline no-caps class="ghost" label="Upload" @click="openPicker" />
          </div>

          <label
            class="dropzone"
            :class="{ 'is-busy': isUploadBusy, 'is-dragover': isDragover }"
            @dragover.prevent="onDragOver"
            @dragenter.prevent="onDragOver"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
          >
            <input
              ref="fileInput"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              class="dropzone__input"
              :disabled="isUploadBusy"
              @change="onFileChosen"
            />
            <div class="dropzone__text">
              <template v-if="store.cvParseStatus === 'extracting'">Extracting text…</template>
              <template v-else-if="store.cvParseStatus === 'structuring'">Structuring profile fields…</template>
              <template v-else>Drag a new CV here, or <span class="link">browse files</span></template>
            </div>
            <div class="dropzone__hint font-mono">PDF, DOCX · max 10MB</div>
          </label>
          <div v-if="uploadMessage" class="upload-msg font-mono">{{ uploadMessage }}</div>

          <div class="chips">
            <span v-for="c in cvTags" :key="c" class="chip font-mono">{{ c }}</span>
          </div>

          <!-- your details -->
          <div class="eyebrow lbl">Your details</div>
          <q-input
            :model-value="store.profile?.name ?? ''"
            outlined dense class="field"
            placeholder="Alex Morgan"
            label="Full name"
            @update:model-value="onNameChange"
          />

          <!-- links -->
          <div class="eyebrow lbl">LinkedIn &amp; web</div>
          <q-input
            :model-value="store.profile?.linkedinUrl ?? ''"
            outlined dense class="field"
            placeholder="https://www.linkedin.com/in/your-handle"
            label="LinkedIn profile"
            @update:model-value="onLinkedinChange"
          />
          <q-input
            :model-value="firstPortfolioLink"
            outlined dense class="field"
            placeholder="https://alexmorgan.design"
            label="Portfolio / personal site"
            @update:model-value="onPortfolioChange"
          />
          <q-btn flat no-caps class="add-link" label="+ Add link" @click="addLink" />

          <!-- preferences -->
          <div class="eyebrow lbl">Target &amp; preferences</div>
          <div class="grid2">
            <q-input
              :model-value="store.profile?.targetRole ?? ''"
              outlined dense label="Target role"
              @update:model-value="onTargetRoleChange"
            />
            <div class="salary-row">
              <q-input
                :model-value="store.profile?.salaryMin ?? null"
                outlined dense type="number" class="field salary-min" label="Min. salary"
                @update:model-value="onSalaryMinChange"
              />
              <q-input
                :model-value="store.profile?.salaryCurrency ?? 'GBP'"
                outlined dense class="field salary-currency" label="Currency"
                @update:model-value="onSalaryCurrencyChange"
              />
            </div>
          </div>
          <div class="modes">
            <button
              v-for="m in modes"
              :key="m"
              class="mode"
              :class="{ 'is-active': (store.profile?.workMode ?? store.workMode) === m }"
              @click="onWorkModeChange(m)"
            >
              {{ m }}
            </button>
          </div>

          <!-- minimum-scorable gate -->
          <div class="gate" :class="{ 'gate--ok': store.isScorable }">
            <template v-if="store.isScorable">
              <span class="gate__dot gate__dot--ok">✓</span>
              Minimum profile is set — Star can score jobs against your profile.
            </template>
            <template v-else>
              <span class="gate__dot">!</span>
              Add {{ missingFieldsCopy }} so Star can score jobs.
              <span class="gate__hint">Star needs a target role, at least one skill, a location, and a work mode.</span>
            </template>
          </div>

          <div class="actions">
            <q-btn unelevated color="primary" no-caps label="Save profile" @click="saveCurrent" />
            <q-btn outline no-caps class="ghost" label="Re-scan with new profile" @click="markScoresStale" />
          </div>
          <div v-if="store.scoresStale" class="stale font-mono">Existing scores are marked stale.</div>

          <!-- CVPROF-014 AC6: confirm guard for the destructive Clear action.
               Wrapped in q-dialog so the user has an explicit confirm step
               before the CV row + on-disk binary are removed. -->
          <q-dialog v-model="showClearConfirm">
            <q-card class="confirm">
              <div class="confirm__title">Clear your CV?</div>
              <p class="confirm__body">
                This deletes the stored CV file and resets the parsed profile
                fields derived from it. AI match reviews will be marked stale.
              </p>
              <div class="confirm__actions">
                <q-btn v-close-popup flat no-caps label="Cancel" />
                <q-btn
                  unelevated
                  no-caps
                  color="negative"
                  label="Clear CV"
                  :loading="isClearing"
                  @click="confirmClear"
                />
              </div>
            </q-card>
          </q-dialog>
        </div>

        <!-- right rail -->
        <div class="rail">
          <div class="strength">
            <div class="strength__label">Profile strength</div>
            <div class="strength__num">
              <span class="font-serif">{{ store.profileStrength }}</span>
              <span class="font-mono">/100</span>
            </div>
            <q-linear-progress
              :value="store.profileStrength / 100"
              rounded
              color="primary"
              track-color="grey-3"
              size="5px"
              class="strength__bar"
            />
            <div class="checklist">
              <div
                v-for="row in store.strengthRubric"
                :key="row.field"
                class="check"
                :class="{ 'check--todo': !row.achieved }"
              >
                <span v-if="row.achieved" class="check__done">✓</span>
                <span v-else class="check__todo">○</span>
                {{ row.label }}
                <span class="check__pts font-mono">+{{ row.points }}</span>
              </div>
            </div>
          </div>
          <p class="note">Star never applies on your behalf without confirmation. Your CV and links stay on this device.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppStore } from 'src/stores/app-store';

const store = useAppStore();

const fileInput = ref<HTMLInputElement | null>(null);
const uploadMessage = ref<string | null>(null);
const isDragover = ref(false);
const showClearConfirm = ref(false);
const isClearing = ref(false);

const PROFILE_FIELD_LABELS: Record<string, string> = {
  targetRole: 'a target role',
  skills: 'at least one skill',
  location: 'a location',
  workMode: 'a work mode',
};

const modes: Array<'Remote' | 'Hybrid' | 'On-site'> = ['Remote', 'Hybrid', 'On-site'];

const isUploadBusy = computed(
  () => store.cvParseStatus === 'extracting' || store.cvParseStatus === 'structuring',
);

const parseStatusLabel = computed(() => {
  switch (store.cvParseStatus) {
    case 'extracting':
      return 'extracting text…';
    case 'structuring':
      return 'structuring profile fields…';
    case 'error':
      return store.cvParseError ?? 'parse failed';
    case 'ready':
      return 'parsed successfully';
    default:
      return store.currentCv?.parsedFields ? 'parsed successfully' : 'not parsed yet';
  }
});

const cvTags = computed<string[]>(() => {
  const tags: string[] = [];
  const profile = store.profile;
  if (profile?.yearsExperience != null) tags.push(`${profile.yearsExperience} yrs experience`);
  if (profile?.skills?.length) tags.push(`${profile.skills.length} skills`);
  return tags;
});

const firstPortfolioLink = computed(() => store.profile?.links?.[0] ?? '');

const missingFieldsCopy = computed(() => {
  const parts = store.missingScoringFields.map(
    (f) => PROFILE_FIELD_LABELS[f as string] ?? (f as string),
  );
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
});

function formatUploadedAt(ts: number): string {
  if (!ts) return 'just now';
  const diffMs = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return 'today';
  const days = Math.floor(diffMs / day);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

function openPicker() {
  uploadMessage.value = null;
  fileInput.value?.click();
}

function detectMime(file: File): 'pdf' | 'docx' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  return null;
}

async function onFileChosen(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  target.value = '';
  if (!file) return;
  await handleFile(file);
}

function onDragOver(_event: DragEvent) {
  if (isUploadBusy.value) return;
  isDragover.value = true;
}

function onDragLeave(_event: DragEvent) {
  isDragover.value = false;
}

async function onDrop(event: DragEvent) {
  isDragover.value = false;
  if (isUploadBusy.value) return;
  const file = event.dataTransfer?.files?.[0] ?? null;
  if (!file) return;
  await handleFile(file);
}

async function handleFile(file: File) {
  const mime = detectMime(file);
  if (!mime) {
    uploadMessage.value = 'Only PDF or DOCX files are supported.';
    return;
  }
  // Electron 32 removed the File.path property. Resolve the absolute
  // filesystem path through the preload-exposed webUtils.getPathForFile
  // bridge (CVPROF-011) — the File is consumed inside the preload helper.
  const filePath = window.starFile?.getPathForFile(file) ?? '';
  if (!filePath) {
    uploadMessage.value = 'Could not resolve the file path. Try the file picker.';
    return;
  }
  uploadMessage.value = null;
  await store.replaceCv({ filePath, fileName: file.name, mime });
}

async function onNameChange(value: string | number | null) {
  await store.saveProfile({ name: typeof value === 'string' ? value : '' });
}

async function onLinkedinChange(value: string | number | null) {
  await store.saveProfile({ linkedinUrl: typeof value === 'string' ? value : '' });
}

async function onPortfolioChange(value: string | number | null) {
  const next = typeof value === 'string' ? value : '';
  const existing = store.profile?.links ?? [];
  const updated = [...existing];
  if (next) updated[0] = next;
  else updated.splice(0, 1);
  await store.saveProfile({ links: updated });
}

function addLink() {
  const existing = store.profile?.links ?? [];
  void store.saveProfile({ links: [...existing, ''] });
}

async function onTargetRoleChange(value: string | number | null) {
  await store.saveProfile({ targetRole: typeof value === 'string' ? value : '' });
}

async function onSalaryMinChange(value: string | number | null) {
  const num = typeof value === 'number' ? value : value === '' || value == null ? null : Number(value);
  await store.saveProfile({ salaryMin: Number.isFinite(num as number) ? (num as number) : null });
}

async function onSalaryCurrencyChange(value: string | number | null) {
  await store.saveProfile({ salaryCurrency: typeof value === 'string' && value ? value : 'GBP' });
}

async function onWorkModeChange(mode: 'Remote' | 'Hybrid' | 'On-site') {
  await store.setWorkMode(mode);
}

function saveCurrent() {
  // Every field already persists on edit; this button is a no-op
  // confirmation affordance — clear any transient upload message.
  uploadMessage.value = null;
}

function markScoresStale() {
  store.scoresStale = true;
}

function openClearConfirm() {
  uploadMessage.value = null;
  showClearConfirm.value = true;
}

async function confirmClear() {
  isClearing.value = true;
  try {
    await store.clearCv();
  } finally {
    isClearing.value = false;
    showClearConfirm.value = false;
  }
}
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; height: 100%; }
.wrap { max-width: 880px; }
.sub { margin: 7px 0 26px; font-size: 14px; color: var(--text-3); }
.cols { display: grid; grid-template-columns: 1fr 264px; gap: 30px; align-items: start; }
.lbl { margin-bottom: 11px; }

.cv-card { border: 1px solid var(--hair); border-radius: 12px; padding: 16px; background: #fff; display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.cv-card__actions { display: flex; gap: 8px; }
.confirm { padding: 22px 24px; max-width: 420px; }
.confirm__title { font: 600 16px/1.3 var(--font-ui); margin-bottom: 10px; }
.confirm__body { font-size: 13px; color: var(--text-2); margin: 0 0 18px; }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }
.cv-card__icon { width: 44px; height: 52px; border-radius: 7px; background: var(--accent-tint); border: 1px solid var(--input-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cv-card__meta { flex: 1; min-width: 0; }
.cv-card__name { font-size: 14px; font-weight: 600; }
.cv-card__sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

.dropzone { display: block; border: 1.5px dashed var(--border-strong); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 8px; cursor: pointer; &:hover { border-color: var(--accent); background: var(--rail); } &.is-busy { opacity: 0.7; cursor: progress; } &.is-dragover { border-color: var(--accent); background: var(--accent-tint); } }
.dropzone__input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.dropzone__text { font-size: 13px; color: var(--text-3); }
.dropzone__hint { font-size: 11px; color: var(--faint); margin-top: 6px; }
.link { color: var(--accent); font-weight: 600; }
.upload-msg { font-size: 11px; color: var(--muted); margin: 4px 0 8px; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 28px; }
.chip { font-size: 11px; color: var(--text-3); background: var(--accent-tint); padding: 5px 9px; border-radius: 6px; }

.field { margin-bottom: 12px; }
.add-link { color: var(--accent); margin: 0 0 28px; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; margin-bottom: 13px; }
.salary-row { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
.salary-min, .salary-currency { margin-bottom: 0; }
.modes { display: flex; gap: 8px; margin-bottom: 18px; }
.mode { font: 600 12.5px/1 var(--font-ui); color: var(--text-2); background: var(--accent-tint); padding: 8px 13px; border-radius: 8px; border: 0; cursor: pointer;
  &.is-active { color: var(--bg); background: var(--text-strong); }
}
.gate { font-size: 12.5px; color: var(--text-2); padding: 10px 12px; border: 1px solid var(--hair); border-radius: 8px; background: var(--rail); margin-bottom: 18px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.gate--ok { color: var(--olive-text); }
.gate__dot { color: var(--accent); font-weight: 700; }
.gate__dot--ok { color: var(--olive-text); }
.gate__hint { width: 100%; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.actions { display: flex; gap: 10px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }
.stale { font-size: 11px; color: var(--muted); margin-top: 8px; }

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
.check__pts { margin-left: auto; font-size: 11px; color: var(--faint); }
.note { font-size: 12px; color: var(--muted); line-height: 1.6; padding: 0 4px; }
</style>
