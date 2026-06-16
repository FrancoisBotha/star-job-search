<template>
  <!--
    Star match score. A precise fractional star rating: an empty row of
    stars with a clipped terracotta-filled row layered on top.
  -->
  <span
    class="star-rating"
    :style="{ fontSize: size + 'px', letterSpacing: gap + 'px' }"
    role="img"
    :aria-label="`${score.toFixed(1)} out of 5 stars`"
  >
    <span class="star-rating__empty">★★★★★</span>
    <span class="star-rating__fill" :style="{ width: pct + '%' }">★★★★★</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ score: number; size?: number; gap?: number }>(),
  { size: 13, gap: 2 },
);

const pct = computed(() => Math.round((props.score / 5) * 100));
</script>

<style scoped lang="scss">
.star-rating {
  position: relative;
  display: inline-block;
  white-space: nowrap;
  line-height: 1;
  &__empty { color: #e3dccb; }
  &__fill {
    position: absolute;
    inset: 0;
    color: var(--accent);
    overflow: hidden;
    white-space: nowrap;
  }
}
</style>
