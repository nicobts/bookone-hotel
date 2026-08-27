import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextPlugin from '@next/eslint-plugin-next'
import turboPlugin from 'eslint-plugin-turbo'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { turbo: turboPlugin },
    rules: {
      'turbo/no-undeclared-env-vars': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // ADR-012: no agent or domain module may import a model vendor SDK directly.
    // LLM access goes through the LlmProvider abstraction in @bookone/core.
    files: ['packages/agents/**/*.ts', 'packages/core/**/*.ts', 'apps/**/*.{ts,tsx}'],
    ignores: ['packages/core/src/llm/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'ADR-012: use the LlmProvider abstraction in @bookone/core/llm.',
            },
            {
              name: 'openai',
              message: 'ADR-012: use the LlmProvider abstraction in @bookone/core/llm.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  prettier,
)
