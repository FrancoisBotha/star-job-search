<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAppStore } from 'src/stores/app-store';

// Root component — hydrate the persisted Profile singleton on boot
// (CVPROF-015 AC1) so the sidebar, dashboard greeting, and Profile page
// reflect the last-saved values without the user having to open
// Onboarding first.
const store = useAppStore();
onMounted(() => {
  void store.loadProfile();
});
</script>
