const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Terminal } = require('@xterm/xterm');

function loadOutput() {
  const filename = path.join(__dirname, '../src/lib/terminal-output.ts');
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  // No animation frame API: processing must work without a visible window.
  vm.runInNewContext(js, { exports, setTimeout, clearTimeout }, { filename });
  return exports.createTerminalOutput;
}

test('ConPTY end-of-frame and delayed cursor restoration are written together', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const output = loadOutput()({ write: (data, done) => { writes.push(data); done(); } });
  output.write('\x1b[?2026l');
  t.mock.timers.tick(2);
  output.write('\x1b[5;10H\x1b[?25h');
  t.mock.timers.tick(3);
  assert.deepEqual(writes, [], 'do not expose the cursor between native pipe reads');
  t.mock.timers.tick(1);
  assert.deepEqual(writes, ['\x1b[?2026l\x1b[5;10H\x1b[?25h']);
  output.dispose();
});

test('continuous output has a deadline and large output flushes immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const output = loadOutput()({ write: (data, done) => { writes.push(data); done(); } });
  output.write('a');
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(3);
    output.write('a');
  }
  assert.equal(writes.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(writes, ['aaaaaa']);
  const large = 'b'.repeat(64 * 1024);
  output.write(large);
  assert.equal(writes[1], large);
  output.dispose();
});

test('slow parsing preserves order and exit waits for the final parsed write', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const parsed = [];
  const output = loadOutput()({ write: (data, done) => { writes.push(data); parsed.push(done); } });
  output.write('first');
  t.mock.timers.tick(4);
  output.write('second');
  t.mock.timers.tick(20);
  output.write('third');
  let exited = false;
  output.flush(() => { exited = true; });
  assert.deepEqual(writes, ['first']);
  assert.equal(exited, false);
  parsed.shift()();
  assert.deepEqual(writes, ['first', 'secondthird']);
  assert.equal(exited, false);
  parsed.shift()();
  assert.equal(exited, true);
  output.dispose();
});

test('disposing cancels pending output and in-flight completion callbacks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  let parsed;
  const output = loadOutput()({ write: (data, done) => { writes.push(data); parsed = done; } });
  output.write('first');
  output.flush();
  output.write('stale');
  output.flush(() => assert.fail('disposed session must not dispatch an exit'));
  output.dispose();
  parsed();
  output.write('after disposal');
  t.mock.timers.tick(100);
  assert.deepEqual(writes, ['first']);
});

test('fragmented TUI controls retain cursor, modes, Unicode and terminal replies', async () => {
  const term = new Terminal({ allowProposedApi: true, cols: 40, rows: 10, cursorBlink: false });
  const output = loadOutput()(term);
  const replies = [];
  term.onData(data => replies.push(data));
  const frame = '\x1b[?1049h\x1b[?2026h\x1b[?25l\x1b[2J\x1b[2;3HПривет ┌─┐'
    + '\x1b[6 q\x1b[5;10H\x1b[?2026l\x1b[?25h\x1b[6n\x1b[?25$p';
  for (const character of frame) output.write(character);
  await new Promise(resolve => output.flush(resolve));
  assert.equal(term.buffer.active.type, 'alternate');
  assert.equal(term.modes.synchronizedOutputMode, false);
  assert.equal(term.buffer.active.getLine(1).translateToString(true), '  Привет ┌─┐');
  assert.equal(term.buffer.active.cursorX, 9);
  assert.equal(term.buffer.active.cursorY, 4);
  assert.deepEqual(replies, ['\x1b[5;10R', '\x1b[?25;1$y']);

  output.write('\x1b[?25l\x1b[?25$p\x1b[?1049l');
  await new Promise(resolve => output.flush(resolve));
  assert.equal(replies.at(-1), '\x1b[?25;2$y', 'a cursor hidden by the TUI stays hidden');
  assert.equal(term.buffer.active.type, 'normal');
  output.dispose();
  term.dispose();
});
