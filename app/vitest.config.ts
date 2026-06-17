import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        esModuleInterop: true,
        strict: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src-electron/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
