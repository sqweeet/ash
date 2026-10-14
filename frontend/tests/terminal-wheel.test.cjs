const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Terminal } = require('@xterm/xterm');

const filename = path.join(__dirname, '../src/lib/terminal-wheel.ts');
const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
vm.runInNewContext(js, { exports: moduleExports }, { filename });
const { configureTerminalWheel } = moduleExports;

function fixture(t, fallback = false, options = {}) {
  const term = new Terminal({ allowProposedApi: true, cols: 80, rows: 20, scrollback: 100, ...options });
  const input = [];
  let wheel;
  const rect = { left: 100, top: 50, width: 800, height: 400 };
  Object.defineProperty(term, 'element', { value: {
    querySelector: selector => selector === '.xterm-screen' ? { getBoundingClientRect: () => rect } : null,
  } });
  const attach = term.attachCustomWheelEventHandler.bind(term);
  term.attachCustomWheelEventHandler = handler => { wheel = handler; attach(handler); };
  term.onData(data => input.push(data));
  let knownApplication = fallback;
  const dispose = configureTerminalWheel(term, () => knownApplication);
  t.after(() => { dispose(); term.dispose(); });
  return {
    term, input, rect,
    setFallback(value) { knownApplication = value; },
    write: data => new Promise(resolve => term.write(data, resolve)),
    wheel(deltaY, overrides = {}) {
      let prevented = false;
      const accepted = wheel({
        deltaY, deltaMode: 1, clientX: 225, clientY: 155,
        shiftKey: false, altKey: false, ctrlKey: false,
        preventDefault() { prevented = true; }, ...overrides,
      });
      return { accepted, prevented };
    },
  };
}

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';

test('unknown fullscreen apps never receive wheel-generated arrows or page keys', async t => {
  const f = fixture(t);
  await f.write(ENTER_ALT);
  for (const cursorMode of ['\x1b[?1h', '\x1b[?1l']) {
    await f.write(cursorMode);
    assert.deepEqual(f.wheel(-3), { accepted: false, prevented: true });
    assert.deepEqual(f.wheel(3), { accepted: false, prevented: true });
  }
  assert.deepEqual(f.input, []);
});

test('known SGR fullscreen app receives native wheel reports with grid coordinates', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  f.wheel(-3);
  f.wheel(3);
  assert.deepEqual(f.input, ['\x1b[<64;13;6M', '\x1b[<65;13;6M']);
  f.setFallback(false);
  f.wheel(-3);
  assert.equal(f.input.length, 2, 'losing application detection immediately disables compatibility input');
});

test('normal buffer retains native scrollback and never uses the SGR fallback', async t => {
  const f = fixture(t, true);
  await f.write('line\r\n'.repeat(40));
  assert.deepEqual(f.wheel(-3), { accepted: true, prevented: false });
  await f.write(ENTER_ALT + LEAVE_ALT);
  assert.equal(f.wheel(3).accepted, true);
  assert.deepEqual(f.input, []);
});

test('normal buffer with scrollback disabled does not fall through to xterm arrow keys', t => {
  const f = fixture(t, true, { scrollback: 0 });
  assert.deepEqual(f.wheel(-3), { accepted: false, prevented: true });
  assert.deepEqual(f.input, []);
});

test('application-requested mouse modes keep xterm native reporting', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  for (const [mode, name] of [[1000, 'vt200'], [1002, 'drag'], [1003, 'any']]) {
    await f.write(`\x1b[?${mode}h\x1b[?1006h`);
    assert.equal(f.term.modes.mouseTrackingMode, name);
    assert.deepEqual(f.wheel(-3), { accepted: true, prevented: false });
    await f.write(`\x1b[?${mode}l`);
  }
  assert.deepEqual(f.input, [], 'custom handler must not duplicate native reports');
});

test('explicit mouse disable and X10 mode are never overridden by compatibility input', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT + '\x1b[?1000l');
  assert.equal(f.wheel(-3).accepted, false);
  await f.write('\x1b[?9h');
  assert.equal(f.term.modes.mouseTrackingMode, 'x10');
  f.wheel(-3);
  await f.write('\x1b[?9l');
  f.wheel(-3);
  assert.deepEqual(f.input, []);

  await f.write(LEAVE_ALT + ENTER_ALT);
  f.wheel(-3);
  assert.deepEqual(f.input, ['\x1b[<64;13;6M'], 'a fresh fullscreen session has fresh mode state');
});

test('trackpad fragments accumulate, reset on direction change, and do not become page jumps', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  for (let i = 0; i < 19; i++) f.wheel(-1, { deltaMode: 0 });
  assert.equal(f.input.length, 0);
  f.wheel(-1, { deltaMode: 0 });
  assert.deepEqual(f.input, ['\x1b[<64;13;6M']);
  for (let i = 0; i < 10; i++) f.wheel(-1, { deltaMode: 0 });
  for (let i = 0; i < 20; i++) f.wheel(1, { deltaMode: 0 });
  assert.equal(f.input.at(-1), '\x1b[<65;13;6M');
  f.wheel(-1, { deltaMode: 2 });
  assert.equal(f.input.length, 3, 'one event stays one report; the application chooses the distance');
});

test('fallback preserves modifiers and accounts for a zoomed terminal grid', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  f.rect.width *= 2;
  f.rect.height *= 2;
  f.wheel(-3, { clientX: 350, clientY: 260, altKey: true, shiftKey: true, ctrlKey: true });
  assert.deepEqual(f.input, ['\x1b[<92;13;6M']);
  f.wheel(3, { clientX: 2000, clientY: 2000 });
  assert.equal(f.input.at(-1), '\x1b[<65;80;20M');
});

test('empty/horizontal wheel events and hidden terminal geometry generate no input', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  f.wheel(0, { deltaX: 3 });
  f.wheel(NaN);
  f.wheel(Infinity);
  f.rect.height = 0;
  f.wheel(-3);
  assert.deepEqual(f.input, []);
});

test('buffer changes reset partial trackpad gestures', async t => {
  const f = fixture(t, true);
  await f.write(ENTER_ALT);
  f.wheel(-15, { deltaMode: 0 });
  await f.write(LEAVE_ALT + ENTER_ALT);
  f.wheel(-5, { deltaMode: 0 });
  assert.deepEqual(f.input, []);
});
