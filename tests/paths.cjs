// Verify @mention formatting against the real shapes the host returns.
// macOS `POSIX path of selectedFolder` answers WITH a trailing slash, so that
// case is covered explicitly. Run: node tests/paths.cjs
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
    console, setTimeout, clearTimeout, WeakMap, Map, Set, Error, Array, Object, String, Number,
    Boolean, JSON, Promise, Symbol, RegExp, Infinity, Math,
    Element: class {},
    Event: class { constructor(type) { this.type = type; } },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    __ModuleLoader__: { load: (r) => { registration = r; } },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { registration, sandbox };
}

const WORKSPACE = '/home/dev/project';

async function main() {
  const { registration, sandbox } = load();
  const api = registration.factory((s) => modules[s]);

  const inserted = [];
  let picked = null;
  let cwd = WORKSPACE;
  const face = await (async () => {
    const ctx = {
      effect: (fn) => { if (typeof fn === 'function') fn(); return () => {}; },
      get: () => undefined,
      conversation: { createDrafts: () => [], releaseDraftAttachments: () => {} },
      locale: { register: () => {}, bind: () => () => 'x' },
      slots: {
        inject: (_n, factory) => { factory(); return () => {}; },
        register: (options) => { sandbox.__face = options.inject; return () => {}; },
      },
      sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd } } }) } },
      commandUi: { register: () => () => {} },
      remote: {
        directoryPicker: { pick: async () => ({ ok: true, value: picked }) },
        fileReferences: { list: async () => ({ ok: true, value: [] }) },
      },
    };
    api.apply(ctx);
    const f = sandbox.__face('s1');
    f.report('s1', {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
      insertText: (text) => { inserted.push(text); return true; },
      setDraft: () => {},
      addAttachments: () => true,
    }, null);
    return f;
  })();

  // [what the host dialog returns, expected inserted text]
  const cases = [
    [`${WORKSPACE}/src/`, '@src/ '],                                  // macOS trailing slash stripped
    [`${WORKSPACE}/docs`, '@docs/ '],                                 // no trailing slash
    [`${WORKSPACE}/\u{7B2C}\u{4E00}\u{7AE0}`, '@\u{7B2C}\u{4E00}\u{7AE0}/ '], // CJK name
    [`${WORKSPACE}/My Folder/`, '@"My Folder/" '],                    // whitespace -> quoted, closed
    ['/opt/other/place/', '@/opt/other/place/ '],                     // outside the workspace stays absolute
    [WORKSPACE, '@./ '],                                              // the workspace root itself
  ];
  for (const [chosen, expected] of cases) {
    inserted.length = 0;
    picked = chosen;
    const token = await face.api.pickAndInsert('s1');
    assert.deepStrictEqual(inserted, [expected], `pick(${JSON.stringify(chosen)}) -> ${JSON.stringify(inserted)}`);
    console.log(`${JSON.stringify(chosen).padEnd(28)} -> ${JSON.stringify(expected)}`);
  }

  // Cancelling the dialog must insert nothing at all.
  inserted.length = 0;
  picked = null;
  assert.strictEqual(await face.api.pickAndInsert('s1'), null);
  assert.deepStrictEqual(inserted, [], 'cancel must not insert');
  console.log('cancel                       -> no insertion');

  console.log('\nall assertions passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
