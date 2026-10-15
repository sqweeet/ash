const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const filename = path.join(__dirname, '../src', file);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {
    exports, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name) => {
      assert.ok(name in imports, `Unmocked import ${name}`);
      return imports[name];
    },
  }, { filename });
  return exports;
}

const tick = () => new Promise(setImmediate);

test('agent folders render like a shell prompt path', () => {
  const { tildePath } = load('lib/tab-utils.ts', { './layout': {} });
  const home = 'C:\\Users\\me';
  assert.equal(tildePath('C:\\Users\\me\\Desktop\\nightdlc', home), '~/Desktop/nightdlc');
  assert.equal(tildePath('c:\\users\\ME\\Desktop', home), '~/Desktop', 'Windows paths are case-insensitive');
  assert.equal(tildePath('C:\\Users\\me', home + '\\'), '~');
  assert.equal(tildePath('C:\\Users\\mebby\\x', home), 'C:/Users/mebby/x', 'only a whole home segment folds');
  assert.equal(tildePath('D:\\work\\app\\', home), 'D:/work/app');
  assert.equal(tildePath('D:\\', home), 'D:/');
  assert.equal(tildePath('C:\\Users\\me\\x', ''), 'C:/Users/me/x', 'no home yet');
});

test('a dragged tab lands right before or after the row it was dropped on', () => {
  const { moveTabNextTo } = load('lib/tab-utils.ts', { './layout': {} });
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (l) => l.map((t) => t.id).join('');
  assert.equal(ids(moveTabNextTo(list, 'd', 'a', false)), 'dabc', 'up, before the target');
  assert.equal(ids(moveTabNextTo(list, 'a', 'c', true)), 'bcad', 'down, after the target');
  assert.equal(ids(moveTabNextTo(list, 'a', 'd', true)), 'bcda', 'to the end');
  assert.equal(moveTabNextTo(list, 'b', 'c', false), list, 'already there: same array');
  assert.equal(moveTabNextTo(list, 'b', 'a', true), list, 'already there: same array');
  assert.equal(moveTabNextTo(list, 'b', 'b', true), list, 'onto itself');
  assert.equal(moveTabNextTo(list, 'x', 'a', false), list, 'unknown tab');
  assert.equal(moveTabNextTo(list, 'a', 'x', false), list, 'unknown target');
});

test('Codex is detected under both of its Windows binary names, with its folder', async () => {
  let fg = {};
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'], getSession: () => undefined },
    './agent-status': { setAgentStatus() {} },
  });

  fg = { name: 'codex.exe', pid: 1, cwd: 'C:\\Users\\me\\app' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(
    JSON.stringify(detect.getAgentForTerm('t1')),
    JSON.stringify({ id: 'codex', cwd: 'C:\\Users\\me\\app', worktree: null }),
  );

  detect.clearAgent('t1');
  fg = { name: 'codex-x86_64-pc-windows-msvc.exe', pid: 2, cwd: '' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.id, 'codex');
  assert.equal(detect.agentDisplayName('codex'), 'Codex');
});

test('an agent keeps its folder across a failed read and reports folder changes', async () => {
  let fg = {};
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'], getSession: () => undefined },
    './agent-status': { setAgentStatus() {} },
  });
  let changes = 0;
  detect.onAgentDetectChange(() => changes++);

  fg = { name: 'claude.exe', pid: 1, cwd: 'C:\\a' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(changes, 1);

  fg = { name: 'claude.exe', pid: 1, cwd: '' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.cwd, 'C:\\a', 'a one-off failed read keeps the folder');
  assert.equal(changes, 1, 'no re-render when nothing changed');

  fg = { name: 'claude.exe', pid: 1, cwd: 'C:\\b' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.cwd, 'C:\\b');
  assert.equal(changes, 2);

  fg = { name: 'pwsh.exe', pid: 9, cwd: '' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1'), null, 'back at the prompt clears the agent');
  assert.equal(changes, 3);
});

test('an agent in a linked worktree reports it, and a branch switch re-renders', async () => {
  let fg = {};
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'], getSession: () => undefined },
    './agent-status': { setAgentStatus() {} },
  });
  let changes = 0;
  detect.onAgentDetectChange(() => changes++);
  const wt = (branch) => ({ name: 'sidebar', branch, repo: 'C:/me/ash' });

  fg = { name: 'claude.exe', pid: 1, cwd: 'C:/me/ash/.claude/worktrees/sidebar', worktree: wt('feat') };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.worktree?.branch, 'feat');

  fg = { ...fg, worktree: wt('feat') };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(changes, 1, 'an equal worktree from a fresh poll is not a change');

  fg = { ...fg, worktree: wt('fix') };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.worktree?.branch, 'fix');
  assert.equal(changes, 2);

  fg = { ...fg, cwd: '', worktree: null };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.worktree?.branch, 'fix', 'a failed read keeps the worktree');
  assert.equal(changes, 2);
});

test('agent tab titles are the topic alone; the brand only stands in for a missing one', () => {
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => ({}) },
    './term': { sessionIds: () => [], getSession: () => undefined },
    './agent-status': { setAgentStatus() {} },
  });
  assert.equal(detect.agentTabTitle('claude', '\u2810 ash · fix sidebar rows · 1a2b'), 'fix sidebar rows');
  assert.equal(detect.agentTabTitle('claude', '\u2733 Claude Code'), 'Claude Code', 'startup, no topic yet');
  assert.equal(detect.agentTabTitle('opencode', 'OC | refactor api'), 'refactor api');
  assert.equal(detect.agentTabTitle('pi', 'C:/x/ash', 'ash'), 'ash');
  assert.equal(detect.agentTabTitle('pi', 'C:/x/ash'), 'Pi');
  assert.equal(detect.agentTabTitle('codex', 'anything'), 'Codex');
  assert.equal(
    detect.agentCombinedTitle([{ id: 'claude', rawTitle: '\u2810 fix sidebar' }, { id: 'pi', rawTitle: '' }], () => 'ash'),
    'fix sidebar · ash',
  );
});

test('a terminal Claude Code reports working/done from its title spinner', async () => {
  let fg = {};
  let title = '';
  const status = load('lib/agent-status.ts');
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'], getSession: () => ({ lastTitle: title }) },
    './agent-status': status,
  });

  // A spinner title before detection is ignored; detection then picks it up.
  title = '\u2810 ash · fix sidebar rows';
  detect.syncAgentStatus('t1', title);
  assert.equal(status.getAgentStatus('t1'), undefined, 'no agent detected yet');
  fg = { name: 'claude.exe', pid: 1, cwd: 'C:/x/ash' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(status.getAgentStatus('t1'), 'working', 'detected mid-turn');

  detect.syncAgentStatus('t1', '\u2733 fix sidebar rows');
  assert.equal(status.getAgentStatus('t1'), 'done');
  detect.syncAgentStatus('t1', '\u2802 fix sidebar rows');
  assert.equal(status.getAgentStatus('t1'), 'working');
  // Current releases spin ◐/◑ (U+25D0/U+25D1) instead of braille.
  detect.syncAgentStatus('t1', '\u2733 Fix sidebar spinner');
  detect.syncAgentStatus('t1', '\u25d0 Fix sidebar spinner');
  assert.equal(status.getAgentStatus('t1'), 'working');
  detect.syncAgentStatus('t1', '\u25d1 Fix sidebar spinner');
  assert.equal(status.getAgentStatus('t1'), 'working');
  assert.equal(detect.agentTabTitle('claude', '\u25d1 Fix sidebar spinner'), 'Fix sidebar spinner', 'spinner glyph stripped');
  assert.equal(detect.agentTabTitle('claude', '\u25d0 Claude Code'), 'Claude Code');
  detect.syncAgentStatus('t1', 'fix sidebar rows');
  assert.equal(status.getAgentStatus('t1'), 'working', 'markerless title keeps the last state');

  // Claude exits back to the shell: the spinner must not linger.
  fg = { name: 'pwsh.exe', pid: 2, cwd: 'C:/x/ash' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(status.getAgentStatus('t1'), undefined);
});

test("Pi's own title never reads as a running turn", () => {
  const detect = load('lib/agent-detect.ts', { '../backend/core': {}, './term': {}, './agent-status': {} });
  const pi = (title) => detect.parseAgentStatus('pi', title);
  assert.equal(pi('\u03c0 - ash'), null, 'the spaces in "π - folder" are not a spinner');
  assert.equal(pi('\u03c0 - fix sidebar - ash'), null);
  assert.equal(pi('\u2839 \u03c0 ash \u00b7 bash'), 'working', 'a status extension leads with a spinner');
  assert.equal(pi('[42%] \u25f0 \u03c0 ash'), 'working');
  assert.equal(pi('\u2713 \u03c0 ash'), 'done');
});

test('OSC 7501 program status and OSC 9;4 progress, as xterm hands them over', async () => {
  const { Terminal } = require('@xterm/xterm');
  const { parseProgramStatus, parseProgress } = load('lib/program-status.ts');
  const term = new Terminal({ allowProposedApi: true });
  const seen = [];
  term.parser.registerOscHandler(7501, (data) => (seen.push(parseProgramStatus(data)), false));
  term.parser.registerOscHandler(9, (data) => (seen.push(parseProgress(data)), false));
  // Pi's formatProgramStatus: ST-terminated, ":"-joined pairs, base64 msg.
  const pi = (pairs) => `\x1b]7501;${pairs}\x1b\\`;
  await new Promise((done) => term.write(
    '\x1b]7501;?\x1b\\'
    + pi(`state=working:app=pi:msg=${Buffer.from('fix sidebar').toString('base64')}`)
    + pi('state=blocked:app=pi') + pi('state=done:app=pi') + pi('state=error:app=pi')
    + pi('state=idle:app=pi') + pi('state=clear')
    + '\x1b]9;4;3\x07\x1b]9;4;1;40\x07'
    + '\x1b]9;4;0;\x07' // older Pi's clear, with a stray ";"
    + '\x1b]9;4;2;100\x07\x1b]9;4;4;50\x07'
    + '\x1b]9;build finished\x07\x1b]9;9;C:\\work\x07', // notification, cwd report
    done,
  ));
  assert.deepEqual(seen, [
    null, 'working', 'done', 'done', 'done', 'done', 'done',
    'working', 'working', 'done', 'done', 'done',
    null, null,
  ]);
  term.dispose();
});

test('terminals feed agents\' out-of-band status reports to detection', () => {
  const term = readFileSync(path.join(__dirname, '../src/lib/term.ts'), 'utf8');
  assert.match(term, /registerOscHandler\(7501, \(data\) => report\(parseProgramStatus\(data\)\)\)/);
  assert.match(term, /registerOscHandler\(9, \(data\) => report\(parseProgress\(data\)\)\)/);
  const app = readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  assert.match(app, /onStatus: reportAgentStatus,/);
});

test('Muse Code is detected, and a reported run shows only while an agent is there', async () => {
  let fg = {};
  const status = load('lib/agent-status.ts');
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'], getSession: () => ({ lastTitle: '' }) },
    './agent-status': status,
  });

  // The run starts before the process poll sees the agent.
  detect.reportAgentStatus('t1', 'working');
  assert.equal(status.getAgentStatus('t1'), undefined, 'no agent detected yet');
  fg = { name: 'muse-bin-1.4.8-R6256.1.exe', pid: 1, cwd: 'C:/x/ash' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(detect.getAgentForTerm('t1')?.id, 'muse');
  assert.equal(detect.agentDisplayName('muse'), 'Muse Code');
  assert.equal(detect.agentTabTitle('muse', 'whatever muse sets'), 'Muse Code');
  assert.equal(status.getAgentStatus('t1'), 'working', 'the early report still shows');

  detect.reportAgentStatus('t1', 'done');
  assert.equal(status.getAgentStatus('t1'), 'done');
  detect.reportAgentStatus('t1', 'working');

  // Back at the shell: nothing lingers, and a stray report doesn't revive it.
  fg = { name: 'pwsh.exe', pid: 2, cwd: 'C:/x/ash' };
  detect.triggerDetect('t1');
  await tick();
  assert.equal(status.getAgentStatus('t1'), undefined);
  detect.reportAgentStatus('t1', 'working');
  assert.equal(status.getAgentStatus('t1'), undefined);
});

test('Codex, Muse Code and omp say in their titles whether they are working', () => {
  const detect = load('lib/agent-detect.ts', { '../backend/core': {}, './term': {}, './agent-status': {} });
  const codex = (title) => detect.parseAgentStatus('codex', title);
  assert.equal(codex('\u2839 fix sidebar | ash'), 'working', 'activity frame leads');
  assert.equal(codex('fix sidebar | ash'), 'done', 'no frame is the idle state');
  assert.equal(codex('[ ! ] Action Required | ash'), 'done', 'waiting on an approval');
  const muse = (title) => detect.parseAgentStatus('muse', title);
  assert.equal(muse('\u2819 ash'), 'working', 'a frame leads its folder name');
  assert.equal(muse('ash'), 'done');

  const omp = (title) => detect.parseAgentStatus('omp', title);
  assert.equal(omp('\u03c0 \u280b fix sidebar'), 'working');
  assert.equal(omp('\u03c0 \u25d4 fix sidebar'), 'working', '"pulse" spinner style');
  assert.equal(omp('\u03c0 / fix sidebar'), 'working', '"line" spinner style');
  assert.equal(omp('\u03c0 : fix sidebar'), 'working', 'static frame where titles cannot animate');
  assert.equal(omp('\u03c0 \u280b'), 'working', 'no session label yet');
  assert.equal(omp('\u03c0 > fix sidebar'), 'done', "the user's turn");
  assert.equal(omp('\u03c0 ! fix sidebar'), 'done', 'needs attention');
  assert.equal(omp('\u03c0: fix sidebar'), null, 'state separator turned off');
  assert.equal(omp('C:\\WINDOWS\\System32\\pwsh.exe'), null, 'not its title yet');
  assert.equal(detect.agentTabTitle('omp', '\u03c0 \u280b fix sidebar'), 'fix sidebar');
  assert.equal(detect.agentTabTitle('omp', '\u03c0 >'), 'omp');
});

test('output activity: a sustained unprompted burst is a run, and silence ends it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { createActivityMeter } = load('lib/output-activity.ts');
  let clock = 0;
  const advance = (ms) => {
    clock += ms;
    t.mock.timers.tick(ms);
  };
  const seen = [];
  const meter = createActivityMeter((status) => seen.push(status), () => clock);
  const spin = (ms, every = 80) => {
    for (let elapsed = 0; elapsed < ms; elapsed += every) {
      meter.output();
      advance(every);
    }
  };

  spin(1000); // a startup screen settling
  advance(3000);
  assert.deepEqual(seen, [], 'a short burst is not a run');

  spin(1700); // a spinner turning
  assert.deepEqual(seen, ['working']);
  advance(2100);
  assert.deepEqual(seen, ['working', 'done'], 'two quiet seconds end it');

  for (let i = 0; i < 40; i++) {
    meter.input();
    advance(50);
    meter.output();
    advance(50);
  }
  assert.deepEqual(seen, ['working', 'done'], 'the echo of typing is not work');
  meter.dispose();
});

test('output activity only speaks for agents that announce nothing themselves', async () => {
  let fg = {};
  let ompTitle = '';
  const status = load('lib/agent-status.ts');
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['oc', 'omp'], getSession: (id) => ({ lastTitle: id === 'omp' ? ompTitle : '' }) },
    './agent-status': status,
  });

  // OpenCode's title carries no state, so its output decides.
  fg = { name: 'opencode.exe', pid: 1, cwd: 'C:/x/ash' };
  detect.triggerDetect('oc');
  await tick();
  detect.syncAgentStatus('oc', 'OC | fix sidebar');
  detect.reportAgentActivity('oc', 'working');
  assert.equal(status.getAgentStatus('oc'), 'working');
  detect.reportAgentActivity('oc', 'done');
  assert.equal(status.getAgentStatus('oc'), 'done');

  // omp announces through its title (its idle marker included), so its output
  // is ignored — its startup screen outlasts a burst.
  fg = { name: 'omp.exe', pid: 2, cwd: 'C:/x/ash' };
  ompTitle = '\u03c0 > ash';
  detect.triggerDetect('omp');
  await tick();
  assert.equal(detect.getAgentForTerm('omp')?.id, 'omp');
  assert.equal(detect.agentDisplayName('omp'), 'omp');
  assert.equal(status.getAgentStatus('omp'), 'done');
  detect.reportAgentActivity('omp', 'working');
  assert.equal(status.getAgentStatus('omp'), 'done', 'activity does not override the title');
  detect.syncAgentStatus('omp', '\u03c0 \u280b ash');
  assert.equal(status.getAgentStatus('omp'), 'working');
});

test('Codex with its title frames turned off still shows its runs', async () => {
  const status = load('lib/agent-status.ts');
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => ({ name: 'codex.exe', pid: 1, cwd: 'C:/x/ash' }) },
    './term': { sessionIds: () => ['t1'], getSession: () => ({ lastTitle: '' }) },
    './agent-status': status,
  });
  detect.triggerDetect('t1');
  await tick();
  detect.syncAgentStatus('t1', 'ash');
  assert.equal(status.getAgentStatus('t1'), undefined, 'a frameless title says nothing yet');
  detect.reportAgentActivity('t1', 'working');
  detect.syncAgentStatus('t1', 'fix sidebar | ash'); // the thread got its name mid-run
  assert.equal(status.getAgentStatus('t1'), 'working', 'a retitle does not end the run');
  detect.reportAgentActivity('t1', 'done');
  assert.equal(status.getAgentStatus('t1'), 'done');

  // With frames on, the title takes over: frameless means idle again.
  detect.syncAgentStatus('t1', '\u280b fix sidebar | ash');
  assert.equal(status.getAgentStatus('t1'), 'working');
  detect.reportAgentActivity('t1', 'done');
  assert.equal(status.getAgentStatus('t1'), 'working', 'its output no longer decides');
  detect.syncAgentStatus('t1', 'fix sidebar | ash');
  assert.equal(status.getAgentStatus('t1'), 'done');
});

test('terminals measure output activity against typed input', () => {
  const term = readFileSync(path.join(__dirname, '../src/lib/term.ts'), 'utf8');
  assert.match(term, /output\.write\(data\);\s*activity\.output\(\);/);
  assert.match(term, /term\.onData\(\(\) => activity\.input\(\)\)/);
  const app = readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  assert.match(app, /onActivity: reportAgentActivity,/);
});
