import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: [
            '.pnpm-store/**',
            'artifacts/**',
            'coverage/**',
            'dist/**',
            'node_modules/**',
            'packages/database/src/types.ts',
            'var/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{js,mjs,ts}'],
        languageOptions: {
            ecmaVersion: 2024,
            globals: globals.node,
            sourceType: 'module',
        },
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
            '@stylistic/object-curly-spacing': ['error', 'always'],
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/semi': ['error', 'never'],
        },
    },
)
