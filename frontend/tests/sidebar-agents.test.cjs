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

test('Codex is detected under both of its Windows binary names, with its folder', async () => {
  let fg = {};
  const detect = load('lib/agent-detect.ts', {
    '../backend/core': { invoke: async () => fg },
    './term': { sessionIds: () => ['t1'] },
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
    './term': { sessionIds: () => ['t1'] },
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
    './term': { sessionIds: () => ['t1'] },
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
