<template>
  <div class="discover">
    <template v-if="store.enabledSites.length">
      <!-- embedded browser -->
      <section class="browser">
        <!-- one tab per active job site (Settings → Job sites) -->
        <div class="tabs app-scroll">
          <button
            v-for="s in store.enabledSites"
            :key="s.id"
            type="button"
            class="tab"
            :class="{ 'tab--active': s.id === selectedSiteId }"
            @click="onSelectSite(s.id)"
          >
            {{ s.label || s.host }}
          </button>
        </div>
        <div class="chrome">
          <div class="chrome__nav">
            <button type="button" class="chrome__btn" aria-label="Back" @click="goBack">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="10 3 5 8 10 13" /></svg>
            </button>
            <button type="button" class="chrome__btn" aria-label="Forward" @click="goForward">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="#dcd6c8" stroke-width="1.6"><polyline points="6 3 11 8 6 13" /></svg>
            </button>
          </div>
          <div class="chrome__url">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#7a8b5a" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
            <span class="font-mono">{{ activeUrl || 'No site loaded' }}</span>
            <span class="chrome__tag"><span class="scan-dot" />Star browsing</span>
          </div>
          <div
            v-if="activeUsername"
            class="chrome__username"
          >
            <span class="chrome__username-label">User</span>
            <span class="chrome__username-value font-mono">{{ activeUsername }}</span>
            <button
              type="button"
              class="chrome__username-copy"
              aria-label="Copy username"
              @click="onCopyUsername"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
                <rect x="5" y="5" width="8" height="8" rx="1.5" />
                <path d="M3 11V4a1 1 0 0 1 1-1h7" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            class="chrome__extract"
            :disabled="store.isExtracting"
            @click="onExtract"
          >
            <span class="scan-dot" />AI Extract
          </button>
          <!-- XJOB-004 AC1 — single-job "Extract this job" control.
               Sibling button (NOT a mode of the bulk AI Extract). Disabled
               with a clear reason via :title when key or default model is
               missing — same gate the main-side IPC enforces, mirrored here
               for defence-in-depth. -->
          <button
            type="button"
            class="chrome__extract chrome__extract--single"
            :disabled="!store.canExtractVisibleJob || store.isExtractingVisible"
            :title="store.canExtractVisibleJob ? 'Extract the job posting open in this tab' : store.extractVisibleDisabledReason"
            @click="onExtractThisJob"
          >
            <span class="scan-dot" />Extract this job
          </button>
        </div>

        <!-- XJOB-004 AC2 — single-job extract status chip. Renders the
             extracting state, success line ("Added: {title} — {company}"),
             "no posting" empty state, and code-driven error message. -->
        <div
          v-if="store.extractVisibleStatus !== 'idle'"
          class="progress progress--single"
          :class="{ 'progress--error': store.extractVisibleStatus === 'error' || store.extractVisibleStatus === 'no_posting' }"
          role="status"
          aria-live="polite"
        >
          <span v-if="store.extractVisibleStatus === 'extracting'">
            <span class="scan-dot" />Extracting this job…
          </span>
          <span
            v-else-if="store.extractVisibleStatus === 'success' && store.extractVisibleLastJob"
            class="progress__success"
          >
            Added: {{ store.extractVisibleLastJob.title ?? 'Untitled role' }} — {{ store.extractVisibleLastJob.company ?? 'Unknown company' }}
            <button type="button" class="progress__dismiss" aria-label="Dismiss" @click="store.resetExtractVisible">×</button>
          </span>
          <span
            v-else-if="store.extractVisibleStatus === 'no_posting'"
            class="progress__error"
            role="alert"
          >
            Couldn't find a job posting on this page. Open a job's detail view and try again.
            <button type="button" class="progress__dismiss" aria-label="Dismiss" @click="store.resetExtractVisible">×</button>
          </span>
          <span
            v-else-if="store.extractVisibleStatus === 'error'"
            class="progress__error"
            role="alert"
          >
            {{ extractVisibleMessage }}
            <button type="button" class="progress__dismiss" aria-label="Dismiss" @click="store.resetExtractVisible">×</button>
          </span>
        </div>

        <div
          v-if="store.isExtracting || progressMessage || store.extractError"
          class="progress"
          :class="{ 'progress--error': !!store.extractError }"
          role="status"
          aria-live="polite"
        >
          <span v-if="store.extractError" class="progress__error" role="alert">
            Extraction failed: {{ store.extractError }}
          </span>
          <span v-else>{{ progressMessage }}</span>
        </div>

        <!-- The real embedded BrowserView is overlaid on top of this surface
             via starBrowser.setBounds (it lives in the native layer, not the
             DOM). Loading / error overlays render behind it. -->
        <div ref="surfaceEl" class="surface">
          <div v-if="isLoading" class="overlay overlay--loading" role="status" aria-live="polite">
            <span class="scan-dot" />
            <span>Loading…</span>
          </div>
          <div v-if="loadError" class="overlay overlay--error" role="alert">
            Failed to load this site. {{ loadError }}
          </div>
        </div>
      </section>

    </template>

    <!-- XJOB-004 AC3 — one-time "what is sent" disclosure (Epic 4 / FR-005).
         Reuses the existing reviewDisclosureAcknowledged flag (same copy as
         AI Match Review + Tailoring) so the first send from the Discover
         chrome shares the user's existing acknowledgement state — no new
         disclosure is introduced. Plain DOM (not q-dialog) so the chrome
         stays opinionated about NOT pulling in new Quasar components. -->
    <div
      v-if="showExtractDisclosure"
      class="disclosure-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-disclosure-title"
    >
      <div class="disclosure">
        <div id="extract-disclosure-title" class="disclosure__title font-serif">
          What we send to your AI provider
        </div>
        <p class="disclosure__body">
          Star will send the <strong>rendered text</strong> of the job posting open in this
          tab to your configured OpenRouter model so it can structure the title, company,
          location, salary, and description into a board entry. The page itself stays on
          this device. Nothing else is sent.
        </p>
        <p class="disclosure__body">
          This is the same one-time "what is sent" disclosure used by AI Match Review and
          Tailoring. Accepting once unlocks all three.
        </p>
        <div class="disclosure__actions">
          <button type="button" class="disclosure__btn" @click="cancelExtractDisclosure">Cancel</button>
          <button type="button" class="disclosure__btn disclosure__btn--primary" @click="acknowledgeExtractDisclosure">Send &amp; continue</button>
        </div>
      </div>
    </div>

    <!-- Empty state: shown when no ACTIVE sites exist — either none are
         configured, or every saved site has its Active toggle off. -->
    <section v-else class="empty-panel">
      <div class="empty-panel__inner">
        {{
          store.sites.length
            ? 'Every job site is switched off. Turn one on under Settings → Job sites to show it as a tab.'
            : 'Add a site in Settings to start browsing.'
        }}
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAppStore } from 'src/stores/app-store';

const store = useAppStore();

/** XJOB-004 AC3 — disclosure dialog visibility (renderer-local). The
 *  acknowledgement itself lives in the store + localStorage so it is
 *  shared with AI Match Review + Tailoring. */
const showExtractDisclosure = ref(false);

/** XJOB-004 AC2 — stable code-driven copy for the "Extract this job"
 *  error states. NO_POSTING has its own dedicated empty-state line in
 *  the template; everything else surfaces here. */
const EXTRACT_VISIBLE_MESSAGES: Record<string, string> = {
  NO_API_KEY: 'No OpenRouter API key saved. Add one in Settings to enable Extract this job.',
  NO_DEFAULT_MODEL: 'No default model selected. Pick a preferred model in Settings.',
  NO_VIEW: 'No browser tab is open. Pick a site tab above and load a job posting.',
  CAPTURE_FAILED: "Couldn't read the page text. Reload the page and try again.",
  NO_INPUT: "Couldn't read any text from the page. Reload and try again.",
  MODEL_NOT_CAPABLE: 'Your selected model does not support structured output. Choose a function-calling–capable model in Settings.',
  LLM_ERROR: 'The model call failed. Check your connection and try again.',
};

const extractVisibleMessage = computed(() => {
  const code = store.extractVisibleErrorCode;
  if (!code) return store.extractVisibleError ?? 'Extract failed.';
  return EXTRACT_VISIBLE_MESSAGES[code] ?? store.extractVisibleError ?? 'Extract failed.';
});

const selectedSiteId = ref<string | null>(null);
const activeUrl = ref('');
const isLoading = ref(false);
const loadError = ref('');
const surfaceEl = ref<HTMLElement | null>(null);

/**
 * Human-readable progress copy derived from the store's
 * extractProgress snapshot. The store flattens the raw
 * StarExtractProgressEvent (phase + numbers) into
 * { phase, message, done, total } — this computes the per-phase string
 * the chrome bar shows.
 */
const progressMessage = computed(() => {
  const p = store.extractProgress;
  if (!p) return '';
  const done = p.done ?? 0;
  const total = p.total ?? 0;
  switch (p.phase) {
    case 'discover':
      return 'Discovering listing…';
    case 'enumerate':
      return `Found ${done} jobs`;
    case 'dedup':
      return `Found ${done} jobs`;
    case 'extract':
      return `Extracted ${done}/${total}`;
    case 'persist':
    case 'done':
      if (total === 0) {
        return 'No job listings found on this page. Search and apply your filters in the tab above, then run AI Extract again.';
      }
      return `Imported ${done} of ${total} listed`;
    default:
      return p.message ?? '';
  }
});

/**
 * Saved username for the currently selected Discover tab (SITEUSR-003).
 * Derived from `store.sites` so switching tabs (which updates
 * `selectedSiteId`) reactively re-evaluates and hides the affordance when
 * the active site has no saved username.
 */
const activeSite = computed(() =>
  store.sites.find((s) => s.id === selectedSiteId.value) ?? null,
);
const activeUsername = computed(() => {
  const u = activeSite.value?.username;
  return typeof u === 'string' && u.length > 0 ? u : '';
});

/**
 * Silent copy of the active tab's saved username to the system clipboard
 * (SITEUSR-003 AC2). No toast/notification — the spec requires the action
 * to complete without a confirmation message.
 */
async function onCopyUsername() {
  const value = activeUsername.value;
  if (!value) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* silent — no confirmation message either way */
    }
  }
}

async function onExtract() {
  if (store.isExtracting) return;
  await store.triggerExtract();
}

/**
 * XJOB-004 AC2 / AC3 — drive the single-job "Extract this job" action.
 * The button is also disabled by the store gate (`canExtractVisibleJob`)
 * so reaching this handler means key + default model are present.
 *
 * Flow:
 *   1. If the user has not yet acknowledged the existing "what is sent"
 *      disclosure, show the dialog instead of calling the bridge — the
 *      same gate AI Match Review + Tailoring use (no new disclosure copy).
 *   2. Otherwise call `store.extractVisibleJob()`; on success surface the
 *      "Added: {title} — {company}" toast. The store has already pushed
 *      the new JobRecord into `state.jobs`, so the board refreshes
 *      reactively.
 */
async function onExtractThisJob() {
  if (store.isExtractingVisible) return;
  if (!store.reviewDisclosureAcknowledged) {
    store.hydrateReviewDisclosure();
    if (!store.reviewDisclosureAcknowledged) {
      showExtractDisclosure.value = true;
      return;
    }
  }
  await runExtractThisJob();
}

async function runExtractThisJob() {
  // The success line itself is rendered inline in the chrome chip
  // (`Added: {title} — {company}`) bound to store.extractVisibleLastJob, so
  // the action only needs to fire-and-forget here. No notification system is
  // pulled in — the chrome stays opinionated about not introducing new
  // Quasar components beyond the existing q-select.
  await store.extractVisibleJob();
}

function cancelExtractDisclosure() {
  showExtractDisclosure.value = false;
}

async function acknowledgeExtractDisclosure() {
  showExtractDisclosure.value = false;
  store.acknowledgeReviewDisclosure();
  await runExtractThisJob();
}

function applyBounds() {
  const el = surfaceEl.value;
  if (!el || typeof window === 'undefined' || !window.starBrowser) return;
  const r = el.getBoundingClientRect();
  void window.starBrowser.setBounds({
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
}

async function onSelectSite(id: string | null) {
  if (!id) return;
  selectedSiteId.value = id;
  const site = store.sites.find((s) => s.id === id);
  if (!site || typeof window === 'undefined' || !window.starBrowser) return;
  activeUrl.value = site.url;
  loadError.value = '';
  isLoading.value = true;
  try {
    await window.starBrowser.navigate(site.url);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
  }
}

async function goBack() {
  if (typeof window !== 'undefined') await window.starBrowser?.back();
}

async function goForward() {
  if (typeof window !== 'undefined') await window.starBrowser?.forward();
}

let resizeObserver: ResizeObserver | undefined;
const onWindowResize = () => applyBounds();

onMounted(async () => {
  await store.hydrateSites();
  store.hydrateReviewDisclosure();
  store.subscribeExtractProgress();
  if (typeof window !== 'undefined' && window.starBrowser) {
    await window.starBrowser.create();
    if (store.enabledSites.length) {
      await window.starBrowser.show(true);
      applyBounds();
      // Open the first active site so the browser isn't blank on arrival.
      await onSelectSite(store.enabledSites[0]!.id);
    }
  }
  if (surfaceEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => applyBounds());
    resizeObserver.observe(surfaceEl.value);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
});

// Hide the native BrowserView while the empty state is showing so it does
// not float over the empty panel; reveal it again once sites are added.
watch(
  () => store.enabledSites.length,
  async (count) => {
    if (typeof window === 'undefined' || !window.starBrowser) return;
    if (count === 0) {
      selectedSiteId.value = null;
      await window.starBrowser.show(false);
    } else {
      await window.starBrowser.show(true);
      applyBounds();
      // If the active tab was switched off (or none is selected), fall back
      // to the first active site so a tab is always loaded.
      const stillActive = store.enabledSites.some((s) => s.id === selectedSiteId.value);
      if (!stillActive) await onSelectSite(store.enabledSites[0]!.id);
    }
  },
);

onBeforeUnmount(async () => {
  resizeObserver?.disconnect();
  store.unsubscribeExtractProgress();
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onWindowResize);
    await window.starBrowser?.show(false);
  }
});
</script>

<style scoped lang="scss">
.discover { height: 100%; display: flex; min-width: 0; }
.browser { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }

.chrome {
  height: 48px; flex-shrink: 0; border-bottom: 1px solid var(--hair);
  display: flex; align-items: center; gap: 10px; padding: 0 16px; background: #f7f4ed;
  &__nav { display: flex; gap: 4px; color: var(--faint); }
  &__btn {
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; padding: 4px; cursor: pointer; color: inherit;
    &:hover { color: var(--text-2); }
  }
  &__url {
    flex: 1; display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 13px;
    background: #fff; border: 1px solid #e6e1d4; border-radius: 8px;
    .font-mono { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
  &__tag { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 var(--font-mono); color: var(--accent); }
  &__username {
    display: inline-flex; align-items: center; gap: 6px;
    height: 28px; padding: 0 10px;
    background: #fff; border: 1px solid var(--hair); border-radius: 8px;
    color: var(--text-2);
  }
  &__username-label { font: 500 11px/1 var(--font-mono); color: var(--muted); text-transform: uppercase; }
  &__username-value { font-size: 12px; color: var(--text-strong); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__username-copy {
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; padding: 2px; cursor: pointer;
    color: var(--faint);
    &:hover { color: var(--accent); }
  }
  &__extract {
    display: inline-flex; align-items: center; gap: 6px;
    height: 28px; padding: 0 12px;
    background: var(--rail); color: var(--text-2);
    border: 1px solid var(--hair); border-radius: 8px;
    font: 500 12px/1 var(--font-mono); cursor: pointer;
    &:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }
}

.progress {
  flex-shrink: 0; padding: 8px 16px; border-bottom: 1px solid var(--hair);
  background: var(--rail); color: var(--muted);
  font: 500 12px/1 var(--font-mono);
  &--error { color: var(--text-2); }
  &__error { color: var(--text-2); }
  &__success { color: var(--accent); }
  &__dismiss {
    margin-left: 10px; background: transparent; border: 0; padding: 0 4px;
    cursor: pointer; color: inherit; font: 500 14px/1 var(--font-mono);
    &:hover { color: var(--text-2); }
  }
}

.disclosure-backdrop {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  padding: 24px;
}
.disclosure {
  padding: 22px; max-width: 460px; width: 100%;
  background: var(--bg); border: 1px solid var(--hair); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.disclosure__title { font-size: 20px; margin-bottom: 10px; color: var(--text-strong); }
.disclosure__body { font-size: 13px; color: var(--text-2); margin: 0 0 12px; line-height: 1.5; }
.disclosure__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.disclosure__btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 14px;
  background: transparent; color: var(--text-2);
  border: 1px solid var(--hair); border-radius: 8px;
  font: 500 13px/1 var(--font-ui); cursor: pointer;
  &:hover { color: var(--text-strong); border-color: var(--text-2); }
  &--primary {
    background: var(--accent); color: #fff; border-color: var(--accent);
    &:hover { color: #fff; opacity: 0.92; }
  }
}

.surface { flex: 1; position: relative; min-height: 0; background: var(--bg); }

.overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 8px; color: var(--muted); font-size: 13px; padding: 24px; text-align: center;
  background: var(--bg);
  &--error { color: var(--text-2); }
}

.empty-panel {
  flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center;
  background: var(--bg);
  &__inner {
    color: var(--muted); font-size: 13px; padding: 24px; text-align: center; max-width: 360px;
  }
}

/* Browser-style tab strip: one tab per active job site. */
.tabs {
  flex-shrink: 0; display: flex; gap: 2px; align-items: stretch;
  height: 38px; padding: 0 8px; background: #efeadf;
  border-bottom: 1px solid var(--hair); overflow-x: auto; overflow-y: hidden;
}
.tab {
  flex-shrink: 0; align-self: flex-end;
  max-width: 200px; height: 30px; padding: 0 14px;
  display: inline-flex; align-items: center;
  background: transparent; border: 1px solid transparent; border-bottom: 0;
  border-radius: 8px 8px 0 0;
  font: 500 12px/1 var(--font-ui); color: var(--text-3); cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &:hover { color: var(--text-2); background: rgba(255, 255, 255, 0.5); }
  &--active {
    background: var(--bg); color: var(--text-strong);
    border-color: var(--hair); border-bottom-color: var(--bg);
  }
}
</style>
