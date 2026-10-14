const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadTs(filename) {
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(js, {
    exports: exportsObject,
    require: specifier => specifier.startsWith('.')
      ? loadTs(path.resolve(path.dirname(filename), specifier + '.ts'))
      : require(specifier),
  }, { filename });
  return exportsObject;
}
const WindowControls = loadTs(path.join(__dirname, '../src/components/WindowControls.tsx')).default;
const defaults = { maximized: false, onMinimize() {}, onToggleMaximize() {}, onClose() {} };

test('caption buttons have accessible labels and do not submit forms', () => {
  const tree = WindowControls(defaults);
  assert.equal(tree.props.role, 'group');
  assert.equal(tree.props['aria-label'], 'Window controls');
  const buttons = Array.from(tree.props.children);
  assert.deepEqual(buttons.map(button => button.props['aria-label']), ['Minimize', 'Maximize', 'Close']);
  for (const button of buttons) {
    assert.equal(button.type, 'button');
    assert.equal(button.props.type, 'button');
    assert.equal(button.props.title, button.props['aria-label']);
  }
});

test('caption actions remain separate and restore uses the correct icon and label', () => {
  const calls = [];
  const props = { ...defaults, maximized: true,
    onMinimize: () => calls.push('minimize'),
    onToggleMaximize: () => calls.push('toggle'),
    onClose: () => calls.push('close'),
  };
  const buttons = WindowControls(props).props.children;
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, ['minimize', 'toggle', 'close']);
  assert.equal(buttons[1].props['aria-label'], 'Restore');
  const restored = renderToStaticMarkup(React.createElement(WindowControls, props));
  const normal = renderToStaticMarkup(React.createElement(WindowControls, defaults));
  assert.notEqual(restored.match(/<path[^>]+>/g)[1], normal.match(/<path[^>]+>/g)[1]);
});

test('Windows 11 caption glyphs keep their native 10px cell without font rendering', () => {
  for (const maximized of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(WindowControls, { ...defaults, maximized }));
    assert.equal((html.match(/viewBox="0 0 2048 2048"/g) || []).length, 3);
    assert.equal((html.match(/width="10" height="10"/g) || []).length, 3);
    assert.equal((html.match(/aria-hidden="true" focusable="false"/g) || []).length, 3);
    assert.doesNotMatch(html, /<image|<text|stroke-width|transform=/);
  }
});

test('all four caption outlines preserve Windows 11 rounded corners and caps', () => {
  const { windowCaptionPaths, WINDOW_CAPTION_SIZE } = loadTs(path.join(__dirname, '../src/lib/window-caption-icons.ts'));
  assert.deepEqual(Object.keys(windowCaptionPaths), ['minimize', 'maximize', 'restore', 'close']);
  for (const drawing of Object.values(windowCaptionPaths)) {
    assert.match(drawing, /Q/);
    assert.match(drawing, /Z$/);
  }
  // The first vertex is the lower center intersection of the close diagonals.
  // Its distance to the 1024-unit center determines the perpendicular weight.
  const [, x, y] = windowCaptionPaths.close.match(/^M([\d.]+) ([\d.]+)/);
  assert.equal(Number(x), 1024);
  const weight = Math.SQRT2 * (Number(y) - 1024) * WINDOW_CAPTION_SIZE / 2048;
  assert.ok(Math.abs(weight - 1) < 0.01, `close stroke became ${weight}px thick`);
});
