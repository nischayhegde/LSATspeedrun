import tseslint from '/tmp/hookslint/node_modules/typescript-eslint/dist/index.js'
import reactHooks from '/tmp/hookslint/node_modules/eslint-plugin-react-hooks/index.js'

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
]
