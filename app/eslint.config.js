// ESLint flat config — added by Initiate Stack refresh (2026-06-17).
// Lints the TypeScript renderer (src/), the Electron main process
// (src-electron/), and Vue single-file components. Quasar-generated and
// build-output directories are ignored.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.quasar/**',
      'node_modules/**',
      'src-capacitor/**',
      'src-cordova/**',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // Vue SFC <script> blocks are TypeScript — parse them with the TS parser.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // The codebase marks intentionally-unused args/vars with a leading
      // underscore (e.g. `_f`, `_cb`). Honour that convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
