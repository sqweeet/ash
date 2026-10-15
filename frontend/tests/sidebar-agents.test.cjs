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
