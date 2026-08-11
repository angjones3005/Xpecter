import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Wails injects window.go/window.runtime at build time; declared in
      // wailsjs.d.ts, so no-undef false positives on `window.go` etc. don't
      // apply here, TS already type-checks these.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  }
);
