import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/lib/**', '**/dev-dist/**', '**/node_modules/**', '.emulator-data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
