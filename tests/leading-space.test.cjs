'use strict';
/**
 * Regression for the folder-mention boundary bug.
 *
 * DSH only decorates `@path` mentions that sit at line start / after
 * whitespace. dsh-folder-attach must prepend a space when inserting a mention
 * after prose that ends in a non-whitespace char, otherwise it renders as
 * plain black text.
 *
 * The earlier attempt read the draft by calling useInput() inside the drop
 * callback. useInput is a genuine React snapshot-selector hook (built on
 * useSyncExternalStore); calling it outside render throws, the error was
 * swallowed, and the space was never added. This test models that constraint:
 *   - useInput throws unless a render is in progress
 *   - the component body is "rendered" once with a given draft
 *   - only afterwards is the /folder command run (the callback path)
 * so a fix that defers the hook call into the callback FAILS here, while a
 * fix that reads the hook during render and stores it in a ref PASSES.
 *
 * No production code is mocked: lib/client.js is evaluated verbatim.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT = process.env.FOLDER_ATTACH_CLIENT || path.join(__dirname, '..', 'lib', 'client.js');

/** Evaluate the bundle, return its module factory. */
function loadFactory(sandbox) {
  const source = fs.readFileSync(CLIENT, 'utf8');
  let mod;
  sandbox.window = {
    __ModuleLoader__: { load: (m) => { mod = m; } },
    addEventListener: sandbox.noop, removeEventListener: sandbox.noop,
    dispatchEvent: sandbox.noop, Event: function Event() {},
  };
  sandbox.console = { info: sandbox.noop, warn: sandbox.noop, error: sandbox.noop, log: sandbox.noop };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.Element = function Element() {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  return mod.factory;
}

async function insertedPayload(draft) {
  const noop = () => {};
  let rendering = false;
  let inserted = null;
  let command;
  let EntryComponent;
  let slotInject;

  // A hook that ONLY works during a render — model React's real constraint.
  const useInput = (selector) => {
    if (!rendering) throw new Error('Invalid hook call: useInput outside render');
    return selector({ draft });
  };

  const react = {
    // Real React runs effects after commit; for this test run them immediately
    // during the "render" phase so report() registers the live composer.
    useEffect: (fn) => { if (typeof fn === 'function') fn(); },
    useRef: (initial) => ({ current: initial }),
    useState: () => [false, noop],
    useSyncExternalStore: noop,
  };
  const jsxRuntime = { jsx: () => null, jsxs: () => null, Fragment: function Fragment() {} };

  const sandbox = {
    noop,
    require: (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {};
      throw new Error(`unexpected require(${name})`);
    },
  };
  const factory = loadFactory(sandbox);

  const actions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: (text) => { inserted = text; return true; },
    addAttachments: () => true,
  };
  const ctx = {
    effect: (fn) => { if (typeof fn === 'function') fn(); return noop; },
    locale: { register: noop, bind: () => (k) => k },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/workspace' } } }) } },
    slots: {
      inject: (name, fn) => { if (typeof fn === 'function') fn(); return noop; },
      register: (slot) => { if (slot && typeof slot.inject === 'function') slotInject = slot.inject(); return noop; },
    },
    commandUi: { register: (cmd) => { command = cmd; return noop; } },
    remote: {
      directoryPicker: { pick: async () => ({ ok: true, value: '/Users/sunzhengnan/Desktop/工程实践大赛' }) },
      fileReferences: { list: async () => ({ ok: true, value: [] }) },
    },
    conversation: { createDrafts: () => [], releaseDraftAttachments: noop },
  };

  const mod = factory(sandbox.require);
  // Capture the Component argument passed to ctx.slots.register(...).
  ctx.slots.register = (slot, Component) => {
    if (slot && typeof slot.inject === 'function') slotInject = slot.inject();
    if (typeof Component === 'function') EntryComponent = Component;
    return noop;
  };
  mod.apply(ctx);

  const props = { ...slotInject, sessionId: 's1', inputActions: actions, useInput, t: (k) => k };

  // --- render phase: the ONLY time useInput may be called ---
  rendering = true;
  try {
    EntryComponent(props);
  } finally {
    rendering = false;
  }

  // --- callback phase: /folder command runs after render ---
  assert.ok(command && command.ui && typeof command.ui.run === 'function', '/folder command registered');
  command.ui.run({ sessionId: 's1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return inserted;
}

async function main() {
  const cases = [
    { draft: '如果已经输入了文字，拖进去就是黑色的字，如果没有在对话框输入文字，就是蓝色的超链接', expected: ' ', name: 'after Chinese prose (reported case)' },
    { draft: '写点文字，', expected: ' ', name: 'after punctuation' },
    { draft: 'ends with a space ', expected: '', name: 'after a trailing space' },
    { draft: 'line one\n', expected: '', name: 'after a newline' },
    { draft: '', expected: '', name: 'empty draft' },
  ];
  let failures = 0;
  for (const c of cases) {
    try {
      const text = await insertedPayload(c.draft);
      assert.equal(typeof text, 'string', 'insertText was called');
      assert.equal(text.slice(0, c.expected.length), c.expected, `${c.name}: got ${JSON.stringify(text)}`);
      assert.ok(text.includes('@/Users/sunzhengnan/Desktop/工程实践大赛/'), 'mention present');
      console.log(`PASS ${c.name}: ${JSON.stringify(text)}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${c.name}: ${e.message}`);
    }
  }
  if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
