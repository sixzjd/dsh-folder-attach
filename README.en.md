# dsh-folder-attach

Add folder references to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **web browser** composer.

> [中文](README.md) · requires dsh `>= 0.2.0-rc.2`

## The problem

The DSH composer refuses folders in a browser:

```js
const bridge = globalThis.__DSH_HOST_PATHS__;
if (bridge === void 0 && directory) return t("attachment.directoryDesktopOnly");
// → "Folders can only be added in the desktop app; add individual files in the browser"
```

A browser never reveals the absolute path of a dropped folder, so only the desktop shell (Electron, which injects `__DSH_HOST_PATHS__`) can map a `File` back to a real path. And `@deepseek-ai/dsh` **ships no desktop app today**: `dsh web` accepts only `--host/--port/--no-open/--trusted-host`, and nothing in the published bundle ever writes that global.

This plugin doesn't work around that check. It **changes where the answer comes from**: ask the host, not the browser.

## How it works

The web GUI is two halves — a browser client and a Node host on your machine. The browser is sandboxed; **the host is not**.

DSH already ships a host-side directory chooser (`dsh-host-directory-picker-auto`). On macOS with a loopback bind it resolves to the `native` backend, which runs **on the host**:

```
osascript -e 'choose folder' -e 'POSIX path of selectedFolder'
```

That returns a real absolute path. The plugin wires it to the composer, so the desktop-only branch is never entered.

Dropped folders are resolved by name through `fileReferences/list` — the same indexed fuzzy lookup that backs the `@` completion menu. One call, and the index already excludes `node_modules` and friends.

## Features

| Entry point | Behavior |
|---|---|
| "Add folder" button, left of the composer | Opens the OS folder dialog on the host, inserts `@dir/` |
| `/folder` command | Same |
| Drag / paste a folder | Resolves the name inside the workspace and inserts `@dir/`; non-folder members keep the normal upload path |

What gets inserted is a **standard `@path` mention**, equivalent to what the desktop app produces: workspace-relative inside the workspace, absolute outside it, quoted when the path contains whitespace.

## Install

**From GitHub (works today)**

```bash
dsh plugin --profile web add github:sixzjd/dsh-folder-attach
```

**From npm (once published)**

```bash
dsh plugin --profile web add dsh-folder-attach
```

You can also paste either form into **Plugins → Add** in the sidebar. Reload the browser page afterwards.

<details>
<summary>Install from source</summary>

```bash
git clone https://github.com/sixzjd/dsh-folder-attach.git
cd ~/.dsh/profiles/web        # or your profile directory
dsh plugin --profile web add ./dsh-folder-attach
```

</details>

## Uninstall

```bash
dsh plugin --profile web remove dsh-folder-attach
```

Or flip the switch on the Plugins page. The plugin registers one composer slot, one slash command, and two event listeners — it writes no globals, so removal leaves nothing behind.

## Development

```bash
npm test          # both regression suites
npm run check     # syntax check + tests
```

There is no build step: `dsh-client-modules` serves `lib/client.js` to the browser **byte-for-byte verbatim**, so it is hand-written in the `window.__ModuleLoader__.load` format.

| File | Role |
|---|---|
| `lib/index.js` | Empty host `apply`, making the package a Loader entry so it gets scanned |
| `lib/client.js` | All behavior |
| `cordis.patch.yml` | The composition layer contributed while the bundle is enabled |
| `locale/{en,zh}.json` | Plugin-page display name (**`en.json` must exist**, or `zh.json` is never read) |

## Public seams used

Only extension points the official docs declare — no patched or monkeypatched upstream code:

- `ctx.slots.inject("conversation.input.left", …)` — the documented composer slot
- Its standard props: `sessionId`, `inputActions`, `t`
- `ctx.commandUi.register({ name: "folder", ui: { kind: "action" } })`
- `ctx.remote.directoryPicker.pick()` — host OS dialog, returns an absolute path
- `ctx.remote.fileReferences.list(sessionId, query)` — the index behind the `@` menu

## Known limitations

- **Dropped/pasted** folders can only be resolved by name inside the workspace. The browser hides their paths and that is unavoidable; when a name cannot be located the plugin says so and points at the dialog rather than guessing a path.
- A drop yields a plain `@dir/` **text mention**, not the folder chip the desktop app renders — a chip needs a real path. Functionally equivalent, visually different.
- The indexed lookup is bounded, so in extreme cases a same-named folder may be absent from the candidates and is then treated as unresolved.
- If your profile resolves the directory picker to the `browse` backend (remote / SSH access), the OS dialog is unavailable and `pick` refuses with a message; drag resolution still works.
- Plugin-page display names require `locale/en.json` to be present.

## Why it survives dsh updates

The compatibility gate only checks `@deepseek-ai/dsh*` prefixes in `peerDependencies`, and this plugin declares none, so an update never causes the bundle to be skipped. The real risk is one of the seams above being renamed — in which case the plugin **fails silent** (it just doesn't appear) rather than breaking DSH.

## License

MIT
