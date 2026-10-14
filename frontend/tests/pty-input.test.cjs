const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const filename = path.join(__dirname, '../src/lib/pty.ts');
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const calls = [];
  const invoke = (command, args) => new Promise((resolve, reject) => calls.push({ command, args, resolve, reject }));
  vm.runInNewContext(js, { exports, require: name => {
    if (name === '../backend/core') return { invoke };
    if (name === '../backend/event') return { listen() {} };
    throw new Error(`Unexpected dependency: ${name}`);
  } }, { filename });
  return { ...exports, calls };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('PTY palette replies and the final DA sentinel reach Wails in wire order', async () => {
  const f = fixture();
  const reports = ['\x1b]10;rgb:eded/eded/eded\x1b\\', '\x1b]11;rgb:0606/0606/0606\x1b\\',
    ...Array.from({ length: 16 }, (_, i) => `\x1b]4;${i};rgb:3f3f/d6d6/8f8f\x1b\\`), '\x1b[?1;2c'];
  const pending = reports.map(data => f.ptyWrite('pi', data));
  for (let i = 0; i < reports.length; i++) {
    await tick();
    assert.equal(f.calls.length, i + 1, 'must not dispatch later input before the previous native write completes');
    assert.equal(f.calls[i].command, 'pty_write');
    assert.equal(f.calls[i].args.data, reports[i]);
    f.calls[i].resolve();
  }
  await Promise.all(pending);
});

test('one terminal does not block another terminal input stream', async () => {
  const f = fixture();
  const a = f.ptyWrite('a', 'slow');
  const b = f.ptyWrite('b', 'independent');
  await tick();
  assert.deepEqual(f.calls.map(call => call.args.id), ['a', 'b']);
  f.calls[1].resolve();
  await b;
  f.calls[0].resolve();
  await a;
});

test('a failed PTY write is reported without poisoning future input', async () => {
  const f = fixture();
  const first = f.ptyWrite('pi', 'first');
  const second = f.ptyWrite('pi', 'second');
  await tick();
  f.calls[0].reject(new Error('PTY disappeared'));
  await assert.rejects(first, /PTY disappeared/);
  await tick();
  assert.equal(f.calls[1].args.data, 'second');
  f.calls[1].resolve();
  await second;
  const third = f.ptyWrite('pi', 'after queue drained');
  await tick();
  assert.equal(f.calls[2].args.data, 'after queue drained');
  f.calls[2].resolve();
  await third;
});
