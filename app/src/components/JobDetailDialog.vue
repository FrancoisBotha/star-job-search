<template>
  <q-dialog v-model="open" :maximized="false">
    <div class="jdd app-scroll">
      <header class="jdd__head">
        <div class="jdd__head-meta">
          <div class="font-serif jdd__title">{{ job.title || job.url }}</div>
          <div class="jdd__sub">
            <span v-if="job.company">{{ job.company }}</span>
            <span v-if="job.company && job.location" class="jdd__sep">·</span>
            <span v-if="job.location">{{ job.location }}</span>
          </div>
        </div>
        <q-btn
          v-close-popup
          flat
          dense
          round
          icon="close"
          class="jdd__close"
          aria-label="Close"
        />
      </header>

      <dl class="jdd__chips">
        <div v-if="workMode" class="jdd__chip">
          <dt>Work mode</dt>
          <dd>{{ workMode }}</dd>
        </div>
        <div class="jdd__chip">
          <dt>Salary</dt>
          <dd>{{ salaryLabel }}</dd>
        </div>
      </dl>

      <section v-if="score" class="jdd__section jdd__score">
        <div class="jdd__score-head">
          <div class="font-serif jdd__score-stars-num">{{ score.stars.toFixed(1) }}</div>
          <div>
            <StarRating :score="score.stars" :size="17" :gap="3" />
            <div class="font-mono jdd__score-fit">{{ Math.round(score.percent) }}% profile fit</div>
          </div>
        </div>

        <h3 class="jdd__h3">Score breakdown</h3>
        <ul class="jdd__factors">
          <li v-for="f in score.factors" :key="f.key" class="jdd__factor">
            <div class="jdd__factor-head">
              <span class="jdd__factor-label">{{ factorLabel(f.key) }}</span>
              <span
                v-if="!f.included"
                class="jdd__factor-excluded"
                aria-label="excluded"
              >excluded</span>
              <span v-else class="jdd__factor-included" aria-label="included">included</span>
            </div>
            <ScoreBar
              v-if="f.included"
              :label="''"
              :value="Math.round(f.score)"
              :good="f.score >= 50"
            />
            <p class="jdd__factor-rationale">{{ f.rationale }}</p>
          </li>
        </ul>
      </section>

      <section class="jdd__section">
        <h3 class="jdd__h3">Description</h3>
        <p class="jdd__desc">{{ job.description || 'No description available.' }}</p>
      </section>

      <section class="jdd__section">
        <h3 class="jdd__h3">Source{{ sources.length > 1 ? 's' : '' }}</h3>
        <ul class="jdd__sources">
          <li v-for="s in sources" :key="s.url" class="jdd__source">
            <a
              class="jdd__link"
              href="#"
              @click.prevent="openSource(s.url)"
            >{{ s.hostname }}</a>
          </li>
        </ul>
      </section>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import StarRating from 'src/components/StarRating.vue';
import ScoreBar from 'src/components/ScoreBar.vue';
import type { FactorKey, JobRecord, MatchScore } from 'src/types/models';

/**
 * Extended view of a JobRecord — the renderer-side mirror in
 * `src/types/models.ts` carries only the fields the main-process extractor
 * already persists. The Job Detail dialog also surfaces work mode, salary,
 * and per-board source links when the upstream record provides them. Those
 * extras are typed here as optional so the dialog renders gracefully when
 * they are absent (Scenario 4 / AC2).
 */
export interface JobDetailJob extends JobRecord {
  workMode?: string | null;
  salary?: string | null;
  sources?: Array<{ hostname: string; url: string }> | null;
}

const props = defineProps<{
  modelValue: boolean;
  job: JobDetailJob;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const store = useAppStore();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const workMode = computed(() => props.job.workMode || '');

const salaryLabel = computed(() => {
  const raw = props.job.salary;
  if (raw === undefined || raw === null) return 'not stated';
  const s = String(raw).trim();
  if (!s) return 'not stated';
  return s;
});

const sources = computed(() => {
  const list = props.job.sources;
  if (Array.isArray(list) && list.length > 0) return list;
  return [{ hostname: props.job.hostname, url: props.job.url }];
});

/**
 * The persisted MatchScore for this listing, read from the app-store by
 * `sourceId`. Returning the same MatchScore object whose `factors` the UI
 * renders is what guarantees NFR-003: the displayed stars + percent and
 * the factor breakdown come from one source of truth and reconcile by
 * construction.
 */
const score = computed<MatchScore | null>(
  () => store.scores[props.job.sourceId] ?? null,
);

const FACTOR_LABELS: Record<FactorKey, string> = {
  skills: 'Skills',
  experience: 'Experience',
  location: 'Location',
  salary: 'Salary',
};

function factorLabel(key: FactorKey): string {
  return FACTOR_LABELS[key] ?? key;
}

function openSource(url: string) {
  void store.openExternal(url);
}
</script>

<style scoped lang="scss">
.jdd {
  background: var(--card);
  border-radius: 14px;
  padding: 26px 28px 28px;
  width: min(720px, 92vw);
  max-height: 86vh;
  overflow: auto;

  &__head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 18px;
  }
  &__head-meta { flex: 1; min-width: 0; }
  &__title {
    font-size: 22px;
    line-height: 1.25;
    font-weight: 700;
  }
  &__sub {
    font-size: 13px;
    color: var(--text-3);
    margin-top: 4px;
  }
  &__sep { margin: 0 6px; }
  &__close { color: var(--muted); }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 18px;
    padding: 0;
  }
  &__chip {
    background: var(--olive-tint);
    color: var(--olive-text);
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 12px/1.2 var(--font-mono);
    dt {
      display: inline;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 10.5px;
      opacity: 0.75;
      margin-right: 6px;
    }
    dd {
      display: inline;
      margin: 0;
    }
  }

  &__section { margin-top: 16px; }
  &__h3 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
    margin: 0 0 8px;
  }
  &__desc {
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.55;
    margin: 0;
  }

  &__score-head {
    display: flex;
    align-items: flex-end;
    gap: 13px;
    margin-bottom: 16px;
  }
  &__score-stars-num { font-size: 38px; line-height: 0.85; }
  &__score-fit {
    font-size: 12px;
    font-weight: 600;
    color: var(--olive-text);
    margin-top: 6px;
  }

  &__factors {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  &__factor { display: flex; flex-direction: column; gap: 4px; }
  &__factor-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-2);
  }
  &__factor-label { font-weight: 600; }
  &__factor-excluded {
    font: 500 11px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  &__factor-included {
    font: 500 11px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--olive-text);
  }
  &__factor-rationale {
    margin: 2px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-2);
  }

  &__sources { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  &__source { font-size: 13px; }
  &__link {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
    &:hover { opacity: 0.85; }
  }
}
</style>
