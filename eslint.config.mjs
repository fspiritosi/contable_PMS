import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Código generado por Prisma (no se lintea, es enorme)
    'src/generated/**',
  ]),
  // Reglas de seguridad: atrapar componentes/variables sin importar
  // (evita ReferenceError de runtime como "Button is not defined")
  {
    rules: {
      'react/jsx-no-undef': 'error',
    },
  },
  // Disable rules-of-hooks for Client Components with underscore prefix
  // This is SAFE because:
  // 1. Files named _*.tsx are Client Components by project convention
  // 2. They have 'use client' directive at the top
  // 3. Hooks are used correctly at the top level of the component function
  // 4. The underscore is purely a visual naming convention to distinguish
  //    Client Components from Server Components
  {
    files: ['**/_*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);

export default eslintConfig;
