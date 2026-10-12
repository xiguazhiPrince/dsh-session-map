/**
 * Host half of the canvas row. The canvas itself is a browser plugin, so this
 * module contributes nothing — it exists only because the patch row names the
 * package and the Loader imports its node half.
 *
 * The bundle's OTHER host half is `./acp`, a separate entry point addressed by
 * the subpath specifier `dsh-session-map/acp`. Keeping them apart is what lets
 * one package carry a browser plugin and a mountable-per-agent host provider
 * without either one seeing the other's configuration.
 *
 * @module dsh-session-map
 */

/** Host plugin body: nothing to contribute host-side. */
export function apply(): void {}
