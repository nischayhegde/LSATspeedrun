import tsParser from '@typescript-eslint/parser'
import jsxA11y from 'eslint-plugin-jsx-a11y'

// Deliberately scoped to accessibility. The project has no other lint layer and
// this is not the place to introduce one: a broad ruleset would bury the a11y
// findings this is meant to surface.
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // `StylizedCharacter` takes a domain `role` prop ("visitor", "judge",
      // "guide"). Restricting these rules to DOM elements keeps them from
      // reading that as an ARIA role.
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
    },
  },
]
