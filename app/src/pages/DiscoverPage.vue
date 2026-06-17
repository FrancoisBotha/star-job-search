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
          <button
            type="button"
            class="chrome__extract"
            :disabled="store.isExtracting"
            @click="onExtract"
          >
            <span class="scan-dot" />AI Extract
          </button>
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

async function onExtract() {
  if (store.isExtracting) return;
  await store.triggerExtract();
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
