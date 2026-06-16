<template>
  <div class="score-bar">
    <div class="score-bar__head">
      <span>{{ label }}</span>
      <span class="font-mono" :style="{ color: good ? 'var(--olive-text)' : 'var(--accent)' }">{{ value }}%</span>
    </div>
    <div class="score-bar__track">
      <div
        class="score-bar__fill"
        :style="{ width: value + '%', background: good ? 'var(--olive)' : 'var(--accent)' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label: string; value: number; good?: boolean }>(), {
  good: true,
});
</script>

<style scoped lang="scss">
.score-bar {
  &__head {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--text-2);
    margin-bottom: 6px;
    .font-mono { font-weight: 600; }
  }
  &__track { height: 6px; border-radius: 3px; background: var(--hair); overflow: hidden; }
  &__fill { height: 100%; border-radius: 3px; }
}
</style>
