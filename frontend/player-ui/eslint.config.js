import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      // Many modules export helpers alongside components (deposit flows, rewards, etc.).
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/playerAuth.tsx', 'src/authModalContext.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // Game/catalog code must not import Fingerprint — lobby loading stays independent of security wiring.
  {
    files: [
      'src/components/LobbyHomeSections.tsx',
      'src/pages/LobbyPage.tsx',
      'src/components/GameSearchOverlay.tsx',
      'src/pages/GameLobbyPage.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@fingerprint/react',
              message:
                'Do not couple catalog/game listing to Fingerprint. Use fetch(playerApiUrl(...)) or playerFetch; keep @fingerprint/react in auth/wallet/main only.',
            },
            {
              name: '@fingerprint/agent',
              message:
                'Do not import the Fingerprint agent from catalog/game modules.',
            },
          ],
        },
      ],
    },
  },
])
