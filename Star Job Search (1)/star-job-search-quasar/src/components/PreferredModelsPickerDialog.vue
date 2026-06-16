<template>
  <!--
    LLM-006 AC1 / AC4 — Preferred-models picker.

    Reuses the q-dialog visual system the About dialog uses on SettingsPage
    (no new design tokens introduced). Provides:
      · search across model id / name
      · filter pills: All / Preferred / SOTA / Free
      · sort: Featured / Newest / A->Z / Cost / Context
      · multi-select up to 5, with a "Limit of 5 reached" hint
      · loading / error-by-code / empty states
    Persistence (AC3) is delegated to the store actions
    addPreferredModel / removePreferredModel — toggles round-trip to the
    main-process bridge immediately, so reopening the dialog or restarting
    the app reflects the latest list.
  -->
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card class="picker">
      <div class="picker__head">
        <div class="picker__title font-serif">Choose preferred models</div>
        <div class="picker__sub">Pick up to 5. The default is used when no model is named.</div>
      </div>

      <div class="picker__controls">
        <q-input
          v-model="search"
          outlined dense
          class="picker__search"
          placeholder="Search models…"
          autocomplete="off"
        />

        <div class="picker__pills">
          <q-btn
            v-for="pill in PILLS"
            :key="pill"
            :unelevated="filter === pill"
            :outline="filter !== pill"
            :color="filter === pill ? 'dark' : undefined"
            no-caps dense
            class="picker__pill"
            :label="pill"
            @click="filter = pill"
          />
        </div>

        <div class="picker__sort">
          <span class="picker__sort-lbl">Sort</span>
          <q-select
            v-model="sort"
            :options="SORTS"
            outlined dense
            class="picker__sort-sel"
          />
        </div>
      </div>

      <div class="picker__body">
        <div v-if="store.modelsLoading" class="picker__state">
          <q-spinner size="18px" /> Loading models…
        </div>
        <div v-else-if="store.modelsError" class="picker__state picker__state--err">
          <span class="picker__dot picker__dot--err" />
          {{ errorMessage }}
        </div>
        <div v-else-if="visible.length === 0" class="picker__state">
          No models match these filters.
        </div>
        <div v-else class="picker__list">
          <label
            v-for="m in visible"
            :key="m.id"
            class="picker__row"
            :class="{ 'picker__row--on': isPreferred(m.id) }"
          >
            <q-checkbox
              :model-value="isPreferred(m.id)"
              :disable="!isPreferred(m.id) && atLimit"
              @update:model-value="(v) => onToggle(m.id, v)"
            />
            <div class="picker__meta">
              <div class="picker__name">{{ m.name }}</div>
              <div class="picker__id font-mono">{{ m.id }}</div>
            </div>
            <div class="picker__tags">
              <span v-if="m.sota" class="picker__tag picker__tag--sota">SOTA</span>
              <span v-if="m.free" class="picker__tag picker__tag--free">Free</span>
              <span class="picker__tag">{{ m.contextLengthFormatted }}</span>
            </div>
            <div class="picker__price font-mono">{{ m.priceFormatted }}</div>
          </label>
        </div>
      </div>

      <div class="picker__foot">
        <div class="picker__hint" :class="{ 'picker__hint--warn': atLimit }">
          <template v-if="atLimit">Limit of 5 reached</template>
          <template v-else>{{ selectedCount }} of 5 selected</template>
        </div>
        <q-btn v-close-popup unelevated color="primary" no-caps label="Done" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import type { DerivedModel } from 'src/data/orModels';

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useAppStore();

type Pill = 'All' | 'Preferred' | 'SOTA' | 'Free';
const PILLS: Pill[] = ['All', 'Preferred', 'SOTA', 'Free'];

type Sort = 'Featured' | 'Newest' | 'A->Z' | 'Cost' | 'Context';
const SORTS: Sort[] = ['Featured', 'Newest', 'A->Z', 'Cost', 'Context'];

const search = ref('');
const filter = ref<Pill>('All');
const sort = ref<Sort>('Featured');

// Hydrate the catalogue + persisted preferred list whenever the dialog opens.
// The catalogue fetch is gated so it only re-runs if we don't yet have a
// successful load — this mirrors the LLM-004 store behaviour.
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    if (!store.modelsLoaded && !store.modelsLoading) {
      await store.listModels();
    }
    await store.hydratePreferredModels();
  },
  { immediate: true },
);

const preferredSlugs = computed(() => new Set(store.preferredModels.map((p) => p.slug)));
const selectedCount = computed(() => store.preferredModels.length);
const atLimit = computed(() => selectedCount.value >= 5);

function isPreferred(slug: string) {
  return preferredSlugs.value.has(slug);
}

const visible = computed<DerivedModel[]>(() => {
  let rows = store.models.slice();

  const q = search.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }

  switch (filter.value) {
    case 'Preferred':
      rows = rows.filter((m) => preferredSlugs.value.has(m.id));
      break;
    case 'SOTA':
      rows = rows.filter((m) => m.sota);
      break;
    case 'Free':
      rows = rows.filter((m) => m.free);
      break;
    case 'All':
    default:
      break;
  }

  switch (sort.value) {
    case 'Newest':
      rows.sort((a, b) => b.created - a.created);
      break;
    case 'A->Z':
      rows.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'Cost':
      rows.sort(
        (a, b) =>
          a.promptPriceNum + a.completionPriceNum - (b.promptPriceNum + b.completionPriceNum),
      );
      break;
    case 'Context':
      rows.sort((a, b) => b.contextLengthNum - a.contextLengthNum);
      break;
    case 'Featured':
    default:
      rows.sort((a, b) => {
        if (a.sota !== b.sota) return a.sota ? -1 : 1;
        return a.orderIndex - b.orderIndex;
      });
      break;
  }

  return rows;
});

async function onToggle(slug: string, next: boolean) {
  if (next) {
    if (atLimit.value) return;
    await store.addPreferredModel(slug);
  } else {
    await store.removePreferredModel(slug);
  }
}

// LLM-002 catalogue error codes — keep messages in sync with SettingsPage.
const errorMessage = computed(() => {
  const err = store.modelsError;
  if (!err) return '';
  switch (err.code) {
    case 'NO_API_KEY':
      return 'No API key — save one in Settings and try again.';
    case 'AUTH_ERROR':
      return 'Authentication failed — check your OpenRouter key.';
    case 'RATE_LIMITED':
      return 'Rate limited by OpenRouter — wait a moment and retry.';
    case 'NETWORK_ERROR':
      return 'Network error — could not reach OpenRouter.';
    default:
      return err.message || 'Could not load models.';
  }
});
</script>

<style scoped lang="scss">
.picker {
  width: 640px;
  max-width: 94vw;
  padding: 24px 26px 22px;
  border-radius: 16px;
  background: var(--bg);
}
.picker__head { margin-bottom: 16px; }
.picker__title { font-size: 22px; line-height: 1.15; }
.picker__sub { font-size: 12.5px; color: var(--muted); margin-top: 4px; }

.picker__controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.picker__search { width: 100%; }
.picker__pills { display: flex; gap: 8px; flex-wrap: wrap; }
.picker__pill { min-width: 78px; }
.picker__sort { display: flex; align-items: center; gap: 10px; }
.picker__sort-lbl { font-size: 12px; color: var(--muted); }
.picker__sort-sel { min-width: 170px; }

.picker__body {
  border: 1px solid var(--hair);
  border-radius: 10px;
  max-height: 360px;
  overflow: auto;
  background: #fff;
}
.picker__state {
  display: flex; align-items: center; gap: 9px;
  padding: 22px 18px;
  font-size: 13px; color: var(--muted);
}
.picker__state--err { color: var(--negative); }
.picker__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.picker__dot--err { background: var(--negative); }

.picker__list { display: flex; flex-direction: column; }
.picker__row {
  display: grid;
  grid-template-columns: 32px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--hair-light);
  cursor: pointer;
}
.picker__row:last-child { border-bottom: 0; }
.picker__row--on { background: var(--accent-tint); }
.picker__meta { min-width: 0; }
.picker__name { font-size: 13.5px; font-weight: 600; color: #3a3530; }
.picker__id { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.picker__tags { display: flex; gap: 6px; }
.picker__tag {
  font: 600 10.5px/1 var(--font-mono);
  letter-spacing: 0.04em;
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--rail);
  color: var(--text-2);
}
.picker__tag--sota { background: var(--accent-tint); color: var(--accent); }
.picker__tag--free { background: var(--olive-tint, var(--rail)); color: var(--olive-text); }
.picker__price { font-size: 11.5px; color: var(--muted); white-space: nowrap; }

.picker__foot {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16px;
}
.picker__hint { font-size: 12px; color: var(--muted); }
.picker__hint--warn { color: var(--accent); font-weight: 600; }
</style>
