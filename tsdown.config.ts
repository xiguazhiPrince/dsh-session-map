import type { UserConfig } from 'tsdown'

/**
 * The module-table id the browser kernel registers this plugin's factory under.
 * It must equal the package name: the shell serves the bundle as
 * `/plugins/<id>/client.js` and looks the row up by the same id.
 */
const ID = 'dsh-session-map'

/**
 * The artifacts, one pass.
 *
 * The node half is an ordinary ESM library the Loader imports by package name.
 * Every entry but the first is addressed by a subpath specifier
 * (`dsh-session-map/acp-agent`, `…/acp-preset`). A subpath row is
 * invisible to the browser client scan on purpose — that scan recognizes only a
 * bare package specifier — so those entries cannot collide in the browser module
 * table, and the same entry can be mounted by several rows at once.
 *
 * The browser half is a closure factory: the preset the product's own client
 * packages use is repository-internal (it reads `packages/<group>/<pkg>/package.json` and
 * imports sibling build modules), so this standalone repository states the
 * handoff itself. Everything the shell shares stays an external `require`; this
 * plugin imports none of it, so the bundle carries only its own code.
 *
 * `acp-model.js` is the settings page's pure model, built for Node as well as
 * bundled into the browser half. It decides everything the page does — draft
 * conversion, validation, list edits, the vendor table, and the schema marker
 * that finds the row's settings namespace — so the node test suite can drive it
 * without a DOM or a Host composition.
 *
 * `entryFileNames` pins both artifacts to the paths package.json declares:
 * tsdown's default extension follows the format, so the ESM half would land on
 * `index.mjs` and the Loader would not find `main`.
 * @returns the build-face configs tsdown runs.
 */
export default (): UserConfig[] => [
  {
    name: `${ID}/node`,
    entry: {
      index: 'src/index.ts',
      'acp-agent': 'src/acp-agent/index.ts',
      'acp-preset': 'src/acp-preset/index.ts',
      'acp-model': 'src/client/acp-model.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    // The ACP route bundles its own protocol client, and its config schema
    // bundles schemastery. `@agentclientprotocol/sdk`, its zod peer, and
    // `@deepseek-ai/schemastery` are devDependencies on purpose: the shipped
    // artifacts must stay self-contained so an install resolves no runtime
    // dependency and runs no install-time script. Stated explicitly so the
    // intent is not mistaken for an accident.
    deps: { onlyBundle: false },
    clean: false,
    dts: false,
    sourcemap: true,
    outputOptions: { entryFileNames: '[name].js' },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    clean: false,
    dts: false,
    sourcemap: true,
    // Shared baseline the kernel answers through the injected `require`. This
    // plugin currently imports only `react` (it builds elements with
    // `createElement`, not JSX), but a future JSX import that fell through to
    // the bundler would inline a second React and break hooks in the shell.
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
