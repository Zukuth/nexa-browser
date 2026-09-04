// Flat config (ESLint 9+/10) — first linter this project has ever had.
// Scoped deliberately narrow: this codebase is ~19k lines of hand-written,
// heavily-commented CommonJS/plain-script code with no build step and no
// existing style convention to preserve, so the goal here is catching real
// bugs (unused vars, undeclared globals, obviously-wrong comparisons) —
// not imposing a new formatting style across a codebase that never had one.
// No Prettier/stylistic rules for that reason; add them later as a
// separate, deliberate decision if the project wants one.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // The Users... file is a stray artifact from an unrelated Claude Code
    // scratchpad session, not part of this project — present in the repo's
    // working tree before this ESLint setup even started, never committed.
    ignores: [
      'node_modules/**',
      'build/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      '.claude/**',
      'UsersZukuth*.js'
    ]
  },
  js.configs.recommended,
  {
    // electron/**, scripts/**, top-level config files: Node/CommonJS main
    // process code.
    files: ['electron/**/*.js', 'scripts/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Only scripts/perf-benchmark.js among scripts/**: it drives the real
    // app with Playwright's _electron and its page.evaluate(() =>
    // window.api...) callback bodies are written inline in this Node file
    // but execute in the Electron renderer at runtime — same reasoning as
    // the test/**/*.js block below.
    files: ['scripts/perf-benchmark.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // src/**: the renderer chrome UI. Plain <script> tags (no bundler, no
    // modules — see src/index.html), so i18n-data.js's `window.NEXA_I18N`
    // and renderer.js's own top-level consts/functions are effectively
    // shared globals across those two files; accessed via `window.X` or
    // within the same file, neither of which needs extra config here.
    // module/require added for i18n-data.js's real dual-environment guard
    // ('if (typeof module !== "undefined" && module.exports) ...' — it also
    // loads directly under Node in some test paths, not just via <script>).
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', require: 'readonly' }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Preload scripts run in Electron's isolated-world context — closer to
    // browser globals (window, document) than Node, but with `require`
    // available for the small CommonJS surface Electron exposes there.
    files: ['electron/*preload*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Unit tests (node:test) and Playwright e2e specs/fixtures — Node
    // CommonJS, same as electron/**, kept separate only so a stray
    // `describe`/`test`-as-a-global typo doesn't get flagged as
    // no-undef if a future test framework migration adds real globals here.
    // Browser globals ALSO included: every e2e spec's page.evaluate(() =>
    // window.api...) callback body is written inline in these Node files
    // but actually executes in the Electron renderer at runtime — without
    // this, `window`/`document` inside those callbacks look like undeclared
    // globals to a linter that only ever sees the source text.
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Playwright's own fixture convention: `async ({}, use) => {...}`
      // means "this fixture has no dependency on any other fixture" — the
      // empty destructure IS the API, not a mistake (test/e2e/fixtures.js).
      'no-empty-pattern': 'off'
    }
  },
  {
    // Static HTML fixtures with inline <script> blocks (test/fixtures/*.html)
    // aren't real .js files, so nothing to lint there — not listed on
    // purpose, ESLint only ever looks at files matching a `files` pattern.
    files: ['test/fixtures/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
