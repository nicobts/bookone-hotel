import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextPlugin from '@next/eslint-plugin-next'
import turboPlugin from 'eslint-plugin-turbo'
import prettier from 'eslint-config-prettier'

/** Where ADR-037 allows the AI SDK's UI protocol (never its model providers). */
const CHAT_SURFACES = [
  'packages/ui/src/components/chat/**',
  'apps/*/src/app/api/**/chat/**',
  'apps/*/src/app/**/playground/**',
  // ADR-038: the console's agent chat and the owner's assistant page.
  'apps/*/src/components/agents/**',
  'apps/*/src/app/**/console/assistant/**',
]

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
    // ADR-012 / ADR-023: no agent or domain module may import a model vendor SDK,
    // the AI SDK or a provider package directly.
    // LLM access goes through the LlmProvider abstraction in @bookone/core.
    files: [
      'packages/agents/**/*.ts',
      'packages/core/**/*.ts',
      'packages/ui/**/*.{ts,tsx}',
      'apps/**/*.{ts,tsx}',
    ],
    ignores: ['packages/core/src/llm/**', ...CHAT_SURFACES],
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
            {
              name: 'ai',
              message: 'ADR-023: the AI SDK lives behind LlmProvider in @bookone/core/llm.',
            },
          ],
          patterns: [
            {
              group: ['@ai-sdk/*', '@openrouter/*'],
              message: 'ADR-023: provider packages live behind LlmProvider in @bookone/core/llm.',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-037: the chat interface and its endpoints speak the AI SDK's UI
    // protocol (`ai`'s UI-stream helpers, `@ai-sdk/react`). Model access is
    // still only through LlmProvider: every provider package stays banned here.
    files: CHAT_SURFACES,
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
          patterns: [
            {
              group: ['@ai-sdk/*', '!@ai-sdk/react', '@openrouter/*'],
              message:
                'ADR-037: chat surfaces use the UI protocol only; models go through LlmProvider.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  prettier,
)
