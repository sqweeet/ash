const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const source = file => readFileSync(path.join(__dirname, '../src', file), 'utf8');
const scrollbarRule = source('styles/xterm.css').match(
  /\.xterm \.xterm-scrollable-element > \.scrollbar\.vertical\s*\{([^}]+)\}/,
)[1];
const scrollbarWidth = Number(scrollbarRule.match(/width:\s*(\d+)px/)[1]);

test('terminal fit reserves the actual styled scrollbar width, not xterm default', () => {
  const option = source('lib/term.ts').match(/overviewRuler:\s*\{\s*width:\s*(\d+)\s*\}/);
  assert.ok(option, 'set the gutter width explicitly so FitAddon does not reserve its 14px default');
  assert.equal(Number(option[1]), scrollbarWidth);
});

test('terminal scrollbar occupies the right inset instead of adding a second gap', () => {
  const paneRule = source('styles/welcome.css').match(/\.pane\.term-pane\s*\{([^}]+)\}/)[1];
  assert.match(paneRule, new RegExp(
    `padding-right:\\s*max\\(0px,\\s*calc\\(var\\(--term-pad,\\s*10px\\)\\s*-\\s*${scrollbarWidth}px\\)\\)`,
  ), 'subtract the reserved gutter and clamp at zero for small padding settings');
});

test('terminals give emoji two cells, like the TUI and ConPTY measure them', () => {
  const term = source('lib/term.ts');
  assert.match(term, /term\.loadAddon\(new Unicode11Addon\(\)\)/);
  assert.match(term, /term\.unicode\.activeVersion = "11"/);
  const { Unicode11Addon } = require('@xterm/addon-unicode11');
  const providers = {};
  new Unicode11Addon().activate({ unicode: { register: (p) => (providers[p.version] = p) } });
  for (const ch of ['✅', '❌', '🚀']) {
    assert.equal(providers['11'].wcwidth(ch.codePointAt(0)), 2, `${ch} is wide`);
  }
  for (const ch of ['│', '─', '●', '⎿']) {
    assert.equal(providers['11'].wcwidth(ch.codePointAt(0)), 1, `${ch} stays narrow`);
  }
});
