# dsh-folder-attach

[![test](https://github.com/sixzjd/dsh-folder-attach/actions/workflows/test.yml/badge.svg)](https://github.com/sixzjd/dsh-folder-attach/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Drag a folder into the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web composer and it refuses: "folders can only be added in the desktop app".
This plugin adds folder drag, `/folder`, and a host folder dialog, inserting standard `@path` references.

**It works in a plain browser and in the desktop app alike** — there is no separate desktop-only client here. What that message calls "desktop" is really Electron's injected `__DSH_HOST_PATHS__` path bridge; this plugin supplies an alternative path source for environments without that bridge. With the bridge present (Electron) it prefers the real dropped path; without it (plain browser) it falls back to a host dialog or name resolution.

> [中文](README.md) · requires dsh `>= 0.2.0-rc.2`

## The problem

The DSH composer refuses folders in a browser:

```js
const bridge = globalThis.__DSH_HOST_PATHS__;
if (bridge === void 0 && directory) return t("attachment.directoryDesktopOnly");
// → "Folders can only be added in the desktop app; add individual files in the browser"
```

A browser never reveals the absolute path of a dropped folder, so only Electron (which injects `__DSH_HOST_PATHS__`) can map a `File` back to a real path. This plugin doesn't work around that check. It **changes where the answer comes from**: ask the host, not the browser.

The web GUI is the same interface in both cases — inside the desktop app it runs on an embedded Node host, and `dsh web` runs on a standalone host. "Desktop vs browser" here is only about whether that path bridge exists, not about two different clients.

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

What gets inserted is a **standard `@path` mention**, the same form the `@` completion menu produces: workspace-relative inside the workspace, absolute outside it, quoted when the path contains whitespace.

DSH only recognizes a reference when `@` sits at the start of a line or after whitespace. When the composer already ends in a non-whitespace character, the plugin inserts a leading space first so the mention renders as a blue folder reference instead of plain text.

## Install

```bash
dsh plugin --profile web add dsh-folder-attach
```

Or pin it to a tag straight from GitHub (same source):

```bash
dsh plugin --profile web add github:sixzjd/dsh-folder-attach#v0.1.6
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

- **Without the path bridge** (plain browser), dropped/pasted folders can only be resolved by name inside the workspace. With the bridge (Electron), the real path of the dropped item is used, which is more precise. When a name cannot be located the plugin says so and points at the dialog rather than guessing a path.
- A drop yields a standard `@dir/` mention, rendered as a folder reference in both the composer and sent messages. DSH folder references are **intentionally non-clickable / non-navigable** — the same is true for folders picked from the official `@` menu; only file references open a preview. This plugin does not alter upstream rendering, so behavior stays consistent.
- The indexed lookup is bounded, so in extreme cases a same-named folder may be absent from the candidates and is then treated as unresolved.
- If your profile resolves the directory picker to the `browse` backend (remote / SSH access), the OS dialog is unavailable and `pick` refuses with a message; drag resolution still works.
- On a mixed drop (folder + images) the plugin mirrors the composer's image count/size pre-check, but **counts only the images in that drop**: already-attached images are not readable through any public face. The Host's `validateImageBatch` still enforces the full per-message limit, so this is an earlier and looser notice, not a hole.
- Plugin-page display names require `locale/en.json` to be present.

## Why it survives dsh updates

The compatibility gate only checks `@deepseek-ai/dsh*` prefixes in `peerDependencies`, and this plugin declares none, so an update never causes the bundle to be skipped. The real risk is one of the seams above being renamed — in which case the plugin **fails silent** (it just doesn't appear) rather than breaking DSH.

## License

MIT
