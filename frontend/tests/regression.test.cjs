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
  for (const service of ['Fs', 'Git', 'Tools', 'Sandbox', 'Pty', 'Process', 'Updater', 'App']) {
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
  await invoke('process_run', { id: 'test', program: 'pwsh' });
  assert.equal(JSON.stringify(calls.pop()), JSON.stringify(['Process', 'Run', 'test', 'pwsh', [], '', 120000]));
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

test('delegating writer agents requires approval', async () => {
  const { PermissionGate } = load('lib/agent-engine/permissions.ts');
  for (const tool of ['agent', 'spawn_agents', 'run_workflow']) {
    let request;
    const gate = new PermissionGate('confirm', req => { request = req; });
    const approved = gate.check(tool, {});
    assert.ok(request, `${tool} must prompt`);
    gate.resolve(request.id, false);
    assert.equal(await approved, false);
  }
});

test('web fetch rejects local files and restricts redirect protocols', async () => {
  const calls = [];
  const { webFetchTool } = load('lib/agent-engine/tools/web-fetch.ts', {
    './run-process': { runProcess: async (...args) => { calls.push(args); return { code: 0, stdout: 'ok' }; } },
    './html-to-text': { htmlToText: text => text },
  });
  for (const url of ['file:///C:/secret', 'ftp://example.com/', '--output', 'not a URL']) {
    assert.equal((await webFetchTool.run({ url }, {})).ok, false);
  }
  assert.equal(calls.length, 0);
  assert.equal((await webFetchTool.run({ url: 'https://example.com/' }, {})).ok, true);
  const args = calls[0][1];
  assert.equal(args[args.indexOf('--proto') + 1], '=http,https');
  assert.equal(args[args.indexOf('--proto-redir') + 1], '=http,https');
});

test('deleting a chat waits for in-flight writes and cancels queued saves', async () => {
  let finishWrite;
  const disk = new Map();
  let writes = 0;
  const store = load('lib/chat-store.ts', {
    '../backend/path': { homeDir: async () => 'C:/home' },
    './toast': { toast: () => {} },
    '../backend/core': { invoke: async (command, args) => {
      if (command === 'list_dir') return [];
      if (command === 'write_text') {
        writes++;
        await new Promise(resolve => { finishWrite = resolve; });
        disk.set(args.path, args.contents);
      }
      if (command === 'delete_path') disk.delete(args.path);
    } },
  }, { localStorage: { getItem: () => null, removeItem: () => {} } });
  await store.loadChats();
  const chat = { chatId: 'test', items: [], history: [] };
  store.saveChat(chat);
  await tick();
  assert.equal(writes, 1);
  store.saveChat(chat);
  store.removeChat('test');
  finishWrite();
  await tick();
  assert.equal(writes, 1);
  assert.equal(disk.size, 0);
  store.saveChat(chat);
  await tick();
  assert.equal(writes, 1, 'late unmount save must not resurrect a deleted chat');
});
