import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'functions/lib/**', '**/dev-dist/**', '**/node_modules/**', '.emulator-data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: globals.node } },
);
