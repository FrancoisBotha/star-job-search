<template>
  <div class="discover">
    <template v-if="store.sites.length">
      <!-- embedded browser -->
      <section class="browser">
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

      <!-- site picker dock -->
      <aside class="dock app-scroll">
        <div class="font-serif dock__title">Sites</div>
        <p class="dock__lead">Pick a saved site to open in the embedded browser.</p>

        <div class="eyebrow dock__label">Site</div>
        <q-select
          v-model="selectedSiteId"
          :options="siteOptions"
          option-value="value"
          option-label="label"
          emit-value
          map-options
          outlined
          dense
          class="dock__field"
          @update:model-value="onSelectSite"
        />
      </aside>
    </template>

    <!-- Empty state: shown instead of the browser chrome + dock when no
         sites are configured. (BRWSR-005 AC3/AC4 / Epic §6) -->
    <section v-else class="empty-panel">
      <div class="empty-panel__inner">
        Add a site in Settings to start browsing.
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

const siteOptions = computed(() =>
  store.sites.map((s) => ({ value: s.id, label: s.label || s.host, url: s.url })),
);

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
  if (!id || typeof window === 'undefined' || !window.starBrowser) return;
  const site = store.sites.find((s) => s.id === id);
  if (!site) return;
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
    if (store.sites.length) {
      await window.starBrowser.show(true);
      applyBounds();
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
  () => store.sites.length,
  async (count) => {
    if (typeof window === 'undefined' || !window.starBrowser) return;
    if (count === 0) {
      await window.starBrowser.show(false);
    } else {
      await window.starBrowser.show(true);
      applyBounds();
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

.dock {
  width: 288px; flex-shrink: 0; border-left: 1px solid var(--hair); background: var(--rail); padding: 22px 20px;
  &__title { font-size: 20px; margin-bottom: 4px; }
  &__lead { font-size: 12px; color: var(--muted); margin: 0 0 20px; line-height: 1.5; }
  &__field { margin-bottom: 12px; }
  &__label { margin: 8px 0 11px; }
}
</style>
