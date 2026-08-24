import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'examples/**', // 示例插件为独立 CommonJS（运行于 VM 沙箱），不参与应用 lint
      'resources/agent-tools/**', // 内置插件同样为独立 CommonJS
      'resources/dsh/**', // 应用自带的 DSH 运行时（node.exe + DSH 依赖 + profile），由 build:dsh 生成，第三方代码不参与 lint
      'scripts/validate-dsh-integ.mjs', // DSH 集成冒烟脚本（独立运行，非应用代码）
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
)
