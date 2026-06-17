<template>
  <span class="status-pill" :style="{ background: pill.bg, color: pill.fg }">{{ status }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_PILL, type AppStatus } from 'src/types/models';

const props = defineProps<{ status: AppStatus }>();
const pill = computed(() => STATUS_PILL[props.status]);
</script>

<style scoped lang="scss">
.status-pill {
  display: inline-block;
  font: 600 11.5px/1 var(--font-ui);
  padding: 5px 10px;
  border-radius: 7px;
}
</style>
