// Regression: dropping a folder must resolve automatically without opening the
// workspace directory picker ("Select Workspace Directory"). In the desktop
// Electron app a dragged File carries a real `.path`; use it directly. Fall back
// to the workspace index by basename only when no real path is available. Never
// call directoryPicker.pick() — that API selects/switches the WORKSPACE, not an
// attachment folder, and made every drop pop the workspace chooser.
//
// Run: node tests/drop-resolution.test.cjs
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
  react: { useState: (i) => [i, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useSyncExternalStore: () => null },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
  '@deepseek-ai/dsh-client-ui-primitives': makeNoop(),
};

function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let registration;
  const sandbox = {
    console, setTimeout, clearTimeout, WeakMap, Map, Set, Error, Array, Object, String,
    Number, Boolean, JSON, Promise, Symbol, RegExp, Infinity, Math,
    Element: class {}, Event: class { constructor(type) { this.type = type; } },
    __ModuleLoader__: { load: (r) => { registration = r; } },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.__listeners = new Map();
  sandbox.__dispatched = [];
  sandbox.addEventListener = (type, fn, capture) => { sandbox.__listeners.set(`${type}:${capture === true ? 'capture' : 'bubble'}`, fn); };
  sandbox.removeEventListener = (type, _fn, capture) => { sandbox.__listeners.delete(`${type}:${capture === true ? 'capture' : 'bubble'}`); };
  sandbox.dispatchEvent = (event) => {
    sandbox.__dispatched.push(event.type);
    const fn = sandbox.__listeners.get(`${event.type}:bubble`);
    if (fn) fn(event);
    return true;
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { registration, api: registration.factory((s) => modules[s]), sandbox };
}

async function main() {
  const { api, sandbox } = load();

  const inserted = [];
  let pickerCalls = 0;
  let index = [];
  let injectFaceFactory;
  const ctx = {
    effect: (fn) => { if (typeof fn === 'function') fn(); return () => {}; },
    get: () => undefined,
    conversation: { createDrafts: () => [], releaseDraftAttachments: () => {} },
    locale: { register: () => {}, bind: () => (k, params) => (params ? `${k}:${JSON.stringify(params)}` : k) },
    slots: {
      inject: (_n, factory) => { factory(); return () => {}; },
      register: (options) => { injectFaceFactory = options.inject; return () => {}; },
    },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/work/demo' } } }) } },
    commandUi: { register: () => () => {} },
    remote: {
      directoryPicker: { pick: async () => { pickerCalls += 1; return { ok: true, value: '/work/demo' }; } },
      fileReferences: { list: async (_sid, q) => {
        const needle = String(q).toLowerCase();
        return { ok: true, value: index.filter((c) => c.path.toLowerCase().includes(needle)) };
      } },
    },
  };
  api.apply(ctx);
  const face = injectFaceFactory('s1');
  face.report('s1', {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: (text) => { inserted.push(text); return true; },
    setDraft: () => {}, addAttachments: () => true,
  }, null);

  // The Desktop preload exposes this bridge; DSH itself uses it to map a
  // dragged File to its real host path (dsh-client-ui-conversation/apply.ts).
  let bridge = undefined;
  sandbox.__DSH_HOST_PATHS__ = undefined;
  Object.defineProperty(sandbox, '__DSH_HOST_PATHS__', {
    configurable: true,
    get: () => bridge,
  });

  const drop = (file) => {
    const ev = {
      type: 'drop', target: null,
      preventDefault() {}, stopPropagation() {},
      dataTransfer: {
        types: ['Files'], files: [file],
        items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    };
    sandbox.__listeners.get('drop:capture')(ev);
  };
  const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

  // 0) The reported case: Desktop app, folder outside the workspace (春捂 on
  //    the Desktop), resolved via DSH's own host-path bridge. No picker, no
  //    workspace-index dependency.
  inserted.length = 0; pickerCalls = 0; index = [];
  bridge = { pathFor: (f) => f.hostPath || '' };
  drop({ name: '春捂', size: 0, lastModified: 0, type: '', hostPath: '/Users/sunzhengnan/Desktop/春捂' });
  await settle();
  console.log('bridge outside workspace:', JSON.stringify(inserted), 'pickerCalls=', pickerCalls);
  assert.deepStrictEqual(inserted, ['@/Users/sunzhengnan/Desktop/春捂/ ']);
  assert.strictEqual(pickerCalls, 0, 'must never open the workspace picker');

  // 1) A dragged File with a real path inside the workspace -> relative mention.
  inserted.length = 0; pickerCalls = 0;
  drop({ name: 'design', size: 0, lastModified: 0, type: '', hostPath: '/work/demo/design' });
  await settle();
  console.log('path inside workspace:', JSON.stringify(inserted), 'pickerCalls=', pickerCalls);
  assert.deepStrictEqual(inserted, ['@design/ ']);
  assert.strictEqual(pickerCalls, 0);

  // 2) Bridge present but returns empty, plain-browser File.path usable.
  inserted.length = 0; pickerCalls = 0;
  bridge = { pathFor: () => '' };
  drop({ name: '外部', size: 0, lastModified: 0, type: '', path: '/Users/sunzhengnan/Desktop/工程实践大赛' });
  await settle();
  console.log('File.path fallback:', JSON.stringify(inserted), 'pickerCalls=', pickerCalls);
  assert.deepStrictEqual(inserted, ['@/Users/sunzhengnan/Desktop/工程实践大赛/ ']);
  assert.strictEqual(pickerCalls, 0);

  // 3) No bridge, no path, but the workspace index finds it by name.
  inserted.length = 0; pickerCalls = 0;
  bridge = undefined;
  index = [{ path: 'assets', kind: 'directory' }, { path: 'docs', kind: 'directory' }];
  drop({ name: 'assets', size: 0, lastModified: 0, type: '' });
  await settle();
  console.log('index by name:', JSON.stringify(inserted), 'pickerCalls=', pickerCalls);
  assert.deepStrictEqual(inserted, ['@assets/ ']);
  assert.strictEqual(pickerCalls, 0);

  // 4) No bridge/path and no index hit -> missed notice, still NO picker.
  inserted.length = 0; pickerCalls = 0;
  index = [];
  drop({ name: 'unknown', size: 0, lastModified: 0, type: '' });
  await settle();
  const notice = face.noticeStore.snapshot('s1');
  console.log('unresolved:', JSON.stringify(inserted), 'pickerCalls=', pickerCalls, 'notice=', JSON.stringify(notice));
  assert.deepStrictEqual(inserted, []);
  assert.strictEqual(pickerCalls, 0, 'unresolved drop must not open the workspace picker');
  assert.match(notice.text, /dropped\.missed/);

  console.log('\nall assertions passed');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
