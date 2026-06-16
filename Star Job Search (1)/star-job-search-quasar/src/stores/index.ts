import { defineStore } from '#q-app/wrappers';
import { createPinia } from 'pinia';

/*
 * If not building with SSR mode, you can directly export the Store instantiation;
 * The "store" cb can be async too; either use async/await or return a Promise which resolves
 * with the Store instance.
 */

export default defineStore(() => {
  const pinia = createPinia();
  return pinia;
});
