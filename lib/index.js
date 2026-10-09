/**
 * Host plugin body for dsh-folder-attach.
 *
 * This is a pure UI plugin: the empty `apply` exists so the package appears as a
 * Loader entry (which is what makes `dsh-client-modules` scan its `dsh.client`
 * declaration and serve `lib/client.js` as a browser bundle). All behavior lives
 * in the browser half, which rides two Remotes the composition already mounts:
 * `directoryPicker` (host folder dialog / browse primitives) and `workspaceFiles`
 * (workspace-scoped listing).
 *
 * @module dsh-folder-attach
 */
/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {}

export { apply };
