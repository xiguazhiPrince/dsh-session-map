import type { UserConfig } from 'tsdown'

/**
 * The module-table id the browser kernel registers this plugin's factory under.
 * It must equal the package name: the shell serves the bundle as
 * `/plugins/<id>/client.js` and looks the row up by the same id.
 */
const ID = 'dsh-session-map'

/**
 * Two artifacts, one pass.
 *
 * The node half is an ordinary ESM library the Loader imports by package name.
 * The browser half is a closure factory: the preset the product's own client
 * packages use is repository-internal (it reads `packages/<group>/<pkg>/package.json` and
 * imports sibling build modules), so this standalone repository states the
 * handoff itself. Everything the shell shares stays an external `require`; this
 * plugin imports none of it, so the bundle carries only its own code.
 *
 * `entryFileNames` pins both artifacts to the paths package.json declares:
 * tsdown's default extension follows the format, so the ESM half would land on
 * `index.mjs` and the Loader would not find `main`.
 * @returns the build-face configs tsdown runs.
 */
export default (): UserConfig[] => [
  {
    name: `${ID}/node`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    clean: false,
    dts: false,
    sourcemap: true,
    outputOptions: { entryFileNames: 'index.js' },
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
