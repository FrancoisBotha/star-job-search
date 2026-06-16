<template>
  <div class="app-shell">
    <!-- real (frameless) title bar: drag region + window controls -->
    <div class="titlebar" :class="{ 'is-electron': isElectron }">
      <span v-if="isElectron" class="titlebar__spacer" />
      <span class="titlebar__title font-mono">Star Job Search — {{ screenTitle }}</span>
      <div v-if="isElectron" class="win-controls">
        <button class="win-btn" type="button" aria-label="Minimize" @click="winMinimize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button
          class="win-btn"
          type="button"
          :aria-label="isMaximized ? 'Restore' : 'Maximize'"
          @click="winToggleMax"
        >
          <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
            <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button class="win-btn win-btn--close" type="button" aria-label="Close" @click="winClose">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </div>

    <div class="body">
        <!-- SIDEBAR -->
        <aside class="sidebar">
          <div class="brand">
        <div class="brand__row font-serif"><span class="brand__star">★</span> Star</div>
        <div class="brand__sub">Job Search</div>
      </div>

          <nav class="nav">
            <button
              v-for="item in primaryNav"
              :key="item.name"
              class="nav__item"
              :class="{ 'is-active': activeNav === item.name }"
              @click="go(item.name)"
            >
              <span class="nav__icon" v-html="item.icon" />
              {{ item.label }}
              <span v-if="item.badge" class="nav__badge font-mono">{{ item.badge }}</span>
            </button>

            <hr class="nav__divider" />
            <div class="nav__group">Setup</div>

            <button
              v-for="item in setupNav"
              :key="item.name"
              class="nav__item"
              :class="{ 'is-active': activeNav === item.name }"
              @click="go(item.name)"
            >
              <span class="nav__icon" v-html="item.icon" />
              {{ item.label }}
            </button>
          </nav>

          <button class="user" @click="go('profile')">
            <span class="user__avatar font-serif">AM</span>
            <span class="user__meta">
              <span class="user__name">Alex Morgan</span>
              <span class="user__role">Product Designer</span>
            </span>
          </button>
        </aside>

      <!-- ROUTED SCREEN -->
      <main class="content app-scroll">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from 'src/stores/app-store';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

function go(name: string) {
  void router.push({ name });
}

// Frameless-window controls — wired only when running under Electron
// (in the browser build the dots stay decorative).
const isElectron = typeof window !== 'undefined' && !!window.starWindow;
const isMaximized = ref(false);
function winMinimize() {
  window.starWindow?.minimize();
}
function winToggleMax() {
  window.starWindow?.toggleMaximize();
}
function winClose() {
  window.starWindow?.close();
}
onMounted(() => {
  window.starWindow?.onMaximizedChange((maximized) => {
    isMaximized.value = maximized;
  });
});

// Job detail & tailoring keep "Discover" highlighted.
const activeNav = computed(() => {
  const n = (route.name as string) ?? 'dashboard';
  return n === 'jobdetail' || n === 'tailor' ? 'discover' : n;
});

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  discover: 'Discover',
  starred: 'Starred',
  applications: 'Applications',
  profile: 'Profile',
  settings: 'Settings',
  jobdetail: 'Senior Product Designer',
  tailor: 'Tailoring',
};
const screenTitle = computed(() => TITLES[(route.name as string) ?? 'dashboard'] ?? 'Dashboard');

const ic = {
  grid: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>',
  star: '<span style="font-size:15px;color:#c2683a;">★</span>',
  list: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/></svg>',
  user: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13c0-2.7 2.2-4.4 5-4.4s5 1.7 5 4.4"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="5" r="1.6"/><line x1="7" y1="5" x2="14" y2="5"/><line x1="2" y1="5" x2="3.4" y2="5"/><circle cx="11" cy="11" r="1.6"/><line x1="2" y1="11" x2="9" y2="11"/><line x1="12.6" y1="11" x2="14" y2="11"/></svg>',
};

const primaryNav = computed(() => [
  { name: 'dashboard', label: 'Dashboard', icon: ic.grid, badge: '' },
  { name: 'discover', label: 'Discover', icon: ic.search, badge: '' },
  { name: 'starred', label: 'Starred', icon: ic.star, badge: String(store.matchCount) },
  { name: 'applications', label: 'Applications', icon: ic.list, badge: '14' },
]);
const setupNav = [
  { name: 'profile', label: 'Profile', icon: ic.user },
  { name: 'settings', label: 'Settings', icon: ic.settings },
];
</script>

<style scoped lang="scss">
/* The shell fills the entire (frameless) OS window. */
.app-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.titlebar {
  height: 40px;
  flex-shrink: 0;
  background: var(--titlebar);
  border-bottom: 1px solid var(--titlebar-bd);
  display: flex;
  align-items: stretch;
  user-select: none;
  -webkit-app-region: drag; /* whole bar drags the window */
  &__title {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--muted);
  }
  /* mirrors the controls' width so the centered title stays centered */
  &__spacer { width: 138px; flex-shrink: 0; }
}
/* Windows-style caption buttons, flush to the top-right corner. */
.win-controls {
  display: flex;
  flex-shrink: 0;
  -webkit-app-region: no-drag; /* the buttons are clickable, not draggable */
}
.win-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  &:hover { background: rgba(40, 36, 30, 0.08); }
  &--close:hover { background: #e81123; color: #fff; }
}

.body { flex: 1; display: flex; min-height: 0; }

.sidebar {
  width: 214px;
  flex-shrink: 0;
  border-right: 1px solid var(--hair);
  background: var(--rail);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
}
.brand {
  margin-bottom: 26px;
  padding: 0 8px;
  &__row {
    font-size: 27px;
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  &__star { color: var(--accent); }
  &__sub {
    margin-top: 5px;
    margin-left: 27px; /* aligns under "Star", clearing the star glyph + gap */
    font: 300 13px/1 var(--font-ui);
    letter-spacing: 0.04em;
    color: var(--faint);
  }
}
.nav { display: flex; flex-direction: column; gap: 3px; }
.nav__item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 38px;
  padding: 0 12px;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0 7px 7px 0;
  background: transparent;
  font: 500 13.5px/1 var(--font-ui);
  color: var(--text-3);
  cursor: pointer;
  text-align: left;
  &:hover { background: var(--accent-tint); color: var(--text-strong); }
  &.is-active { font-weight: 600; color: var(--text-strong); background: var(--accent-tint); border-left-color: var(--accent); }
}
.nav__icon { display: inline-flex; width: 16px; justify-content: center; }
.nav__badge { margin-left: auto; font-size: 11px; color: var(--muted); }
.nav__divider { margin: 18px 8px 12px; height: 1px; background: var(--hair); border: 0; }
.nav__group { font: 600 10px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); padding: 0 12px; margin-bottom: 8px; }

.user {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--hair);
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border-left: 0; border-right: 0; border-bottom: 0;
  cursor: pointer;
  text-align: left;
  &__avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: #e8dcc8; color: #9a6b3a;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700;
  }
  &__meta { display: flex; flex-direction: column; line-height: 1.25; }
  &__name { font-size: 12.5px; font-weight: 600; color: #3a3530; }
  &__role { font-size: 11px; color: var(--muted); }
}

.content { flex: 1; min-width: 0; height: 100%; }
</style>
