import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules },
  { ignores: ['dist', 'android', 'node_modules'] });
