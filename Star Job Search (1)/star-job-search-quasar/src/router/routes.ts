import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  // First-run onboarding takes the whole window (no app shell).
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('pages/OnboardingPage.vue'),
  },

  // The app shell (window chrome + sidebar) wraps every working screen.
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('pages/DashboardPage.vue') },
      { path: 'discover', name: 'discover', component: () => import('pages/DiscoverPage.vue') },
      { path: 'starred', name: 'starred', component: () => import('pages/StarredPage.vue') },
      { path: 'applications', name: 'applications', component: () => import('pages/ApplicationsPage.vue') },
      { path: 'profile', name: 'profile', component: () => import('pages/ProfilePage.vue') },
      { path: 'help', name: 'help', component: () => import('pages/HelpPage.vue') },
      { path: 'settings', name: 'settings', component: () => import('pages/SettingsPage.vue') },
      // Job detail & tailoring are reached from match actions; they keep
      // "Discover" highlighted in the sidebar (see MainLayout).
      { path: 'job', name: 'jobdetail', component: () => import('pages/JobDetailPage.vue') },
      { path: 'tailor', name: 'tailor', component: () => import('pages/TailorPage.vue') },
    ],
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/DashboardPage.vue'),
  },
];

export default routes;
