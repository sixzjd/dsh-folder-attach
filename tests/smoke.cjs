// Load the bundle the way the browser module system does, then exercise its
// wiring against a fake client context. Run: node tests/smoke.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

function makeNoop() {
  const fn = function () {};
  return new Proxy(fn, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => 'noop' : makeNoop()),
    apply: () => makeNoop(),
  });
}

const modules = {
  react: {
    useState: (init) => [init, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useSyncExternalStore: () => null,
  },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
  '@deepseek-ai/dsh-client-ui-primitives': makeNoop(),
};

function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let registration;
  const sandbox = {
    console, setTimeout, clearTimeout, WeakMap, Map, Set, Error, Array, Object,
    String, Number, Boolean, JSON, Promise, Symbol, RegExp, Infinity, Math,
    Element: class {},
    Event: class { constructor(type) { this.type = type; } },
    __ModuleLoader__: { load: (reg) => { registration = reg; } },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.__listeners = new Map();
  sandbox.__dispatched = [];
  sandbox.addEventListener = (type, fn, capture) => {
    sandbox.__listeners.set(`${type}:${capture === true ? 'capture' : 'bubble'}`, fn);
  };
  sandbox.removeEventListener = (type, _fn, capture) => {
    sandbox.__listeners.delete(`${type}:${capture === true ? 'capture' : 'bubble'}`);
  };
  sandbox.dispatchEvent = (event) => {
    sandbox.__dispatched.push(event.type);
    const fn = sandbox.__listeners.get(`${event.type}:bubble`);
    if (fn) fn(event);
    return true;
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.ok(registration, 'bundle did not register with __ModuleLoader__');
  const seen = [];
  const api = registration.factory((spec) => {
    seen.push(spec);
    assert.ok(spec in modules, `unexpected require("${spec}")`);
    return modules[spec];
  });
  return { registration, api, seen, sandbox };
}

const { registration, api, seen, sandbox } = load();

console.log('id       :', registration.id);
console.log('requires :', seen.join(', '));
console.log('inject   :', JSON.stringify(api.inject));
assert.strictEqual(registration.id, 'dsh-folder-attach');
assert.strictEqual(typeof api.apply, 'function');
// Only the frozen static module base may be required; anything else is drift.
for (const spec of seen) assert.ok(spec in modules, `requires non-base module ${spec}`);

const calls = { slots: [], commands: [], localeNs: [] };
let injectFaceFactory;
const inserted = [];
const uploaded = [];

const ctx = {
  effect: (fn) => { if (typeof fn === 'function') fn(); return () => {}; },
  get: () => undefined,
  conversation: {
    createDrafts: (_sid, files) => { uploaded.push(...files.map((f) => f.name)); return files.map((_f, i) => ({ id: `d${i}` })); },
    releaseDraftAttachments: () => {},
  },
  locale: {
    register: (ns, dicts) => { calls.localeNs.push(ns); assert.ok(dicts.zh && dicts.en, 'missing dictionaries'); },
    bind: () => (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  },
  slots: {
    inject: (name, factory) => { factory(); calls.slots.push(name); return () => {}; },
    register: (options, component) => {
      injectFaceFactory = options.inject;
      calls.commands.push({ slot: options.name, id: options.id, order: options.order });
      assert.strictEqual(component.name, 'FolderAttachEntry');
      return () => {};
    },
  },
  sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/work/demo' } } }) } },
  commandUi: { register: (spec) => { calls.commands.push({ name: spec.name, kind: spec.ui.kind }); return () => {}; } },
  remote: {
    directoryPicker: { pick: async () => ({ ok: true, value: '/work/demo/sub/' }) },
    // The Host's indexed fuzzy lookup: one call, workspace-relative candidates.
    fileReferences: {
      list: async (_sessionId, query) => {
        const index = [
          { path: 'assets', kind: 'directory' },
          { path: 'deep/assets', kind: 'directory' },
          { path: 'docs', kind: 'directory' },
          { path: 'notes.txt', kind: 'file' },
        ];
        const q = String(query).toLowerCase();
        return { ok: true, value: index.filter((c) => c.path.toLowerCase().includes(q)) };
      },
    },
  },
};

api.apply(ctx);

console.log('slot     :', calls.slots.join(', '));
console.log('entries  :', JSON.stringify(calls.commands));
assert.deepStrictEqual(calls.slots, ['conversation.input.left']);
assert.ok(calls.commands.some((c) => c.name === 'folder' && c.kind === 'action'), '/folder action not registered');

// No global path bridge is installed, so the composer's own Desktop-only gate
// is never entered: this plugin resolves folders itself.
assert.strictEqual(sandbox.__DSH_HOST_PATHS__, undefined, 'must not install the desktop bridge');

const listeners = sandbox.__listeners;
const keys = [...listeners.keys()].sort();
console.log('listeners:', keys.join(', '));
assert.deepStrictEqual(keys, ['drop:capture', 'paste:capture']);

async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
}

async function main() {
  const face = injectFaceFactory('s1');
  const actions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: (text) => { inserted.push(text); return true; },
    setDraft: () => {},
    addAttachments: () => true,
  };
  face.report('s1', actions, null);

  // --- a plain-file drop must pass straight through ------------------------
  const png = { name: 'photo.png', size: 10, lastModified: 1, type: 'image/png' };
  const plainEvent = {
    type: 'drop', target: null,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    dataTransfer: {
      types: ['Files'], files: [png],
      items: [{ kind: 'file', getAsFile: () => png, webkitGetAsEntry: () => ({ isDirectory: false }) }],
    },
  };
  listeners.get('drop:capture')(plainEvent);
  assert.ok(!plainEvent.prevented && !plainEvent.stopped, 'plain file drop must pass through');
  assert.deepStrictEqual(sandbox.__dispatched, [], 'no overlay reset for a pass-through drop');

  // --- a folder drop is claimed, and the overlay IS cleared ----------------
  const folder = { name: 'assets', size: 0, lastModified: 0, type: '' };
  const folderEvent = {
    type: 'drop', target: null,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    dataTransfer: {
      types: ['Files'], files: [folder],
      items: [{ kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) }],
    },
  };
  listeners.get('drop:capture')(folderEvent);
  assert.ok(folderEvent.prevented && folderEvent.stopped, 'folder drop must be claimed');
  // The regression that stranded the full-screen mask: stopping the drop skips
  // the shipped reset, so a synthetic dragend must be dispatched synchronously.
  assert.deepStrictEqual(sandbox.__dispatched, ['dragend'], 'folder drop must clear the drop overlay');

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));

  // Ambiguous basename resolves to the shallowest match, never a coin flip.
  assert.deepStrictEqual(inserted, ['@assets/ '], `expected shallowest match, got ${JSON.stringify(inserted)}`);

  // --- image pre-check mirrors the composer's own --------------------------
  const limits = { mediaTypes: ['image/png'], maxImagesPerMessage: 20, maxImageBytes: 20 * 1024 * 1024, maxMessageImageBytes: 100 * 1024 * 1024 };
  const img = (n) => ({ name: `i${n}.png`, size: 1024, lastModified: 1, type: 'image/png' });
  const dropWith = (files, folders) => {
    inserted.length = 0; uploaded.length = 0; sandbox.__dispatched.length = 0;
    const items = [...folders, ...files].map((f) => ({
      kind: 'file', getAsFile: () => f,
      webkitGetAsEntry: () => ({ isDirectory: folders.includes(f) }),
    }));
    const ev = {
      type: 'drop', target: null,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      dataTransfer: { types: ['Files'], files: [...folders, ...files], items },
    };
    listeners.get('drop:capture')(ev);
    return ev;
  };
  const noticeText = () => (face.noticeStore.snapshot('s1') || {}).text;

  // Limits published by the mounted composer (the component's useProjection seat).
  face.publishLimits('s1', limits);

  // A mixed drop over the image cap is refused WHOLE: nothing uploads, nothing
  // inserts, but the gesture is still claimed and the overlay still cleared.
  const tooMany = [...Array(21)].map((_x, i) => img(i));
  const overEvent = dropWith(tooMany, [folder]);
  assert.ok(overEvent.prevented, 'an over-cap mixed drop is still ours to refuse');
  assert.deepStrictEqual(sandbox.__dispatched, ['dragend'], 'a refused drop must still clear the overlay');
  await settle();
  assert.deepStrictEqual(inserted, [], 'refused drop must insert nothing');
  assert.deepStrictEqual(uploaded, [], 'refused drop must upload nothing');
  assert.match(noticeText(), /image\.tooMany/, 'refusal must name the image limit');

  // Oversized single image, and oversized aggregate, are both caught.
  face.publishLimits('s1', { ...limits, maxImageBytes: 10 });
  dropWith([{ name: 'big.png', size: 999, lastModified: 1, type: 'image/png' }], [folder]);
  await settle();
  assert.match(noticeText(), /image\.fileTooLarge/);
  face.publishLimits('s1', { ...limits, maxMessageImageBytes: 10 });
  dropWith([img(1), img(2)], [folder]);
  await settle();
  assert.match(noticeText(), /image\.totalTooLarge/);

  // Under the cap it proceeds normally: folder resolves, image uploads.
  face.publishLimits('s1', limits);
  inserted.length = 0; uploaded.length = 0;
  dropWith([img(1)], [folder]);
  await settle();
  assert.deepStrictEqual(inserted, ['@assets/ '], 'an in-limit mixed drop must still insert the folder');
  assert.deepStrictEqual(uploaded, ['i1.png'], 'an in-limit mixed drop must still upload the image');

  // Limits unknown means "cannot judge", NOT "unlimited": the Host still
  // enforces, so the drop proceeds rather than being silently refused.
  face.publishLimits('s1', undefined);
  inserted.length = 0; uploaded.length = 0;
  dropWith(tooMany, [folder]);
  await settle();
  assert.strictEqual(uploaded.length, 21, 'absent limits must not block the drop');

  // --- notices -------------------------------------------------------------
  face.noticeStore.publish('s1', 'ok', 'same');
  const first = face.noticeStore.snapshot('s1');
  face.noticeStore.publish('s1', 'ok', 'same');
  assert.notStrictEqual(first, face.noticeStore.snapshot('s1'), 'a repeated notice must re-render');
  assert.strictEqual(face.noticeStore.snapshot(undefined), null);
  let fired = 0;
  const off = face.noticeStore.subscribe(() => { fired += 1; });
  face.noticeStore.publish('s1', 'info', 'ping');
  assert.ok(fired >= 1);
  off();
  const before = fired;
  face.noticeStore.publish('s1', 'info', 'pong');
  assert.strictEqual(fired, before, 'unsubscribed listener still firing');

  console.log('\nall assertions passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
