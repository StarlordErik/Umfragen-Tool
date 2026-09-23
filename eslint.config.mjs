import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    '.artifacts/**',
    'node_modules/**',
    'test-results/**',
    'playwright-report/**',
    'src/projects/olive-symposium/legacy/**',
    'next-env.d.ts',
  ]),
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@/projects/*', '@/app/*', '@/features/*'] },
      ],
    },
  },
]);
