import { defineConfig } from '#q-app/wrappers';

export default defineConfig(() => {
  return {
    // https://v2.quasar.dev/quasar-cli-vite/boot-files
    boot: [],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#css
    css: ['app.scss'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      'material-icons', // optional, used for a few glyphs
    ],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#build
    build: {
      target: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node20',
      },
      typescript: {
        strict: true,
        vueShim: true,
      },
      vueRouterMode: 'hash', // 'hash' plays nicely inside Electron
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#devserver
    devServer: {
      open: true,
      port: 9100,
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#framework
    framework: {
      config: {
        brand: {
          primary: '#c2683a',
          secondary: '#7a8b5a',
          accent: '#9a6b3a',
          dark: '#2a2620',
          'dark-page': '#1d1c1a',
          positive: '#3f7a52',
          negative: '#c0563f',
          info: '#5f6b3a',
          warning: '#c2683a',
        },
      },
      plugins: ['Notify'],
    },

    animations: [],

    // https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/configuring-electron
    electron: {
      preloadScripts: ['electron-preload'],
      inspectPort: 5858,
      bundler: 'packager',
      packager: {},
    },
  };
});
