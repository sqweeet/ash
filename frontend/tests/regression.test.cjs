const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}, globals = {}) {
  const filename = path.join(__dirname, '../src', file);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {
    exports, console, URL, crypto, setTimeout, clearTimeout, AbortSignal,
    require: (name) => {
      assert.ok(name in imports, `Unmocked import ${name}`);
      return imports[name];
    }, ...globals,
  }, { filename });
  return exports;
}

const tick = () => new Promise(setImmediate);

test('Wails routes preserve argument defaults, file creation and empty lists', async () => {
  const calls = [];
  const imports = {};
  for (const service of ['Fs', 'Git', 'Tools', 'Pty', 'Updater', 'App']) {
    imports[`../../wailsjs/go/app/${service}`] = new Proxy({}, {
      get: (_, method) => (...args) => {
        calls.push([service, method, ...args]);
        return Promise.resolve(null);
      },
    });
  }
  const { invoke } = load('backend/core.ts', imports);
  await invoke('create_file', { path: 'new.txt' });
  assert.deepEqual(calls.pop(), ['Fs', 'CreateFile', 'new.txt']);
  await invoke('pty_spawn', { id: 'test', cols: 80, rows: 24 });
  assert.equal(JSON.stringify(calls.pop()), JSON.stringify(['Pty', 'PtySpawn', 'test', 80, 24, '', '', []]));
  assert.equal(JSON.stringify(await invoke('list_dir', { path: '.' })), '[]');
  await assert.rejects(invoke('missing_command'), /Unknown backend command/);
});

test('unsubscribing one Wails listener does not remove sibling listeners', async () => {
  const handlers = new Set();
  const { listen } = load('backend/event.ts', {
    '../../wailsjs/runtime': { EventsOn: (_, cb) => { handlers.add(cb); return () => handlers.delete(cb); } },
  });
  const got = [];
  const off = await listen('pty:data', ({ payload }) => got.push('first:' + payload));
  await listen('pty:data', ({ payload }) => got.push('second:' + payload));
  off();
  handlers.forEach(cb => cb('data'));
  assert.deepEqual(got, ['second:data']);
});

test('native window close can be intercepted for cleanup and then completed', async () => {
  let closeRequest;
  let ready = false;
  let closes = 0;
  let quits = 0;
  const { getCurrentWindow } = load('backend/window.ts', {
    '../../wailsjs/runtime': {
      WindowIsMaximised: async () => false, WindowMinimise() {}, WindowToggleMaximise() {},
      Quit: () => quits++,
      EventsOn: (_, cb) => { closeRequest = cb; return () => { closeRequest = null; }; },
    },
    '../../wailsjs/go/app/App': { Ready: async () => { ready = true; }, Close: async () => { closes++; } },
  });
  const win = getCurrentWindow();
  const off = await win.onCloseRequested(e => e.preventDefault());
  assert.equal(ready, true);
  win.close();
  assert.equal(quits, 1);
  closeRequest();
  assert.equal(closes, 0);
  win.destroy();
  assert.equal(closes, 1);
  off();
  assert.equal(closeRequest, null);
  await win.onCloseRequested(() => {});
  closeRequest();
  assert.equal(closes, 2, 'no cleanup configured: close immediately');
});
