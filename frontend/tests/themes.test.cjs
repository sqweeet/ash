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
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, console, crypto, require: name => {
    assert.ok(name in imports, `Unmocked import ${name}`);
    return imports[name];
  }, ...globals }, { filename });
  return exports;
}

const themes = load('lib/themes.ts');
const gray = themes.resolvedPreset(themes.DEFAULT_THEME_ID, false);
const colors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
const neutralApp = ['bg', 'surface', 'raise', 'text', 'muted', 'faint', 'icon'];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const neutral = color => new Set(rgb(color)).size === 1;
function luminance(hex) {
  const channels = rgb(hex).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (hi + 0.05) / (lo + 0.05);
}

function settingsHarness(saved = null, legacy = null) {
  const writes = [], properties = new Map();
  let pending;
  const mod = load('lib/settings.ts', {
    './themes': themes,
    './toast': { toast() {} },
    '../backend/path': { homeDir: async () => 'C:/test-home' },
    '../backend/core': { invoke: async (command, args) => {
      if (command === 'read_text') return saved;
      assert.equal(command, 'write_text');
      writes.push(JSON.parse(args.contents));
    } },
  }, {
    window: { addEventListener() {}, setTimeout: fn => { pending = fn; return 1; } },
    clearTimeout: () => { pending = undefined; },
    localStorage: { getItem: () => legacy },
    document: { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } } },
  });
  return { mod, writes, properties, flush: () => pending?.() };
}

test('Gray is the selectable default, separate from monochrome Graphite', () => {
  assert.equal(themes.DEFAULT_THEME_ID, 'gray');
  assert.equal(themes.THEMES[0].id, themes.DEFAULT_THEME_ID);
  assert.equal(gray.label, 'Gray');
  assert.equal(new Set(themes.THEMES.map(t => t.id)).size, themes.THEMES.length);
  assert.equal(themes.resolvedPreset('missing-theme', false), gray);
  const graphite = themes.resolvedPreset('graphite', false);
  assert.equal(graphite.id, 'graphite');
  assert.equal(graphite.app.bg, '#0b0b0b');
  for (const key of colors) {
    assert.ok(neutral(graphite.theme[key]), `existing Graphite ${key} must remain monochrome`);
    assert.ok(!neutral(gray.theme[key]), `Gray ${key} lost its hue`);
    const channels = rgb(gray.theme[key]);
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 80, `${key} is too saturated`);
    assert.ok(contrast(gray.theme[key], gray.theme.background) >= 4.5, `${key} is too faint`);
  }
  assert.equal(gray.theme.extendedAnsi, undefined, 'leave extended/truecolor application output alone');
});

test('gray surfaces have no color cast, readable text, and a neutral light variant', () => {
  for (const light of [false, true]) {
    const p = themes.resolvedPreset(themes.DEFAULT_THEME_ID, light);
    for (const key of neutralApp) assert.ok(neutral(p.app[key]), `${key} has a color cast (light=${light})`);
    for (const key of ['black', 'white', 'brightBlack', 'brightWhite'])
      assert.ok(neutral(p.theme[key]), `${key} has a color cast (light=${light})`);
    assert.ok(contrast(p.app.text, p.app.surface) >= 7);
    assert.ok(contrast(p.app.muted, p.app.surface) >= 4.5);
    for (const key of colors) assert.ok(!neutral(p.theme[key]), `${key} became gray (light=${light})`);
  }
  assert.ok(luminance(gray.app.bg) < luminance(gray.app.surface));
  assert.ok(luminance(gray.app.surface) < luminance(gray.app.raise));
  assert.equal(gray.app.bg, '#181818', 'Gray should be darker than the old #202020 chrome');
  assert.equal(gray.app.surface, '#202020', 'terminal surfaces should be darker than the old #282828');
  assert.ok(contrast(gray.theme.brightBlack, gray.theme.background) >= 4.5);
});

test('terminal scrollbar gutter has no ruler border in any theme', () => {
  const { mod } = settingsHarness();
  for (const theme of themes.THEMES) {
    for (const themeLight of [false, true]) {
      const palette = mod.terminalTheme({ ...mod.DEFAULT_SETTINGS, theme: theme.id, themeLight });
      assert.equal(palette.overviewRulerBorder, '#00000000', `${theme.id}, light=${themeLight}`);
      assert.ok(palette.scrollbarSliderBackground, 'keep the scrollbar visible and usable');
    }
  }
});

test('first-paint CSS, splash, and native window match the default gray', () => {
  const css = readFileSync(path.join(__dirname, '../src/styles/base.css'), 'utf8');
  const root = css.match(/:root\s*\{([^}]+)\}/)[1];
  for (const [key, value] of Object.entries(gray.app)) {
    const actual = root.match(new RegExp(`--${key}:\\s*([^;]+);`))[1];
    assert.equal(actual.replace(/\s/g, ''), value.replace(/\s/g, ''), key);
  }
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(html.includes(`<html lang="en" style="background: ${gray.app.bg}">`));
  assert.ok(html.includes(`background: var(--bg, ${gray.app.bg})`));
  const native = readFileSync(path.join(__dirname, '../../internal/app/app.go'), 'utf8');
  const [, r, g, b] = native.match(/BackgroundColour:\s*&options\.RGBA\{R:\s*(\d+), G:\s*(\d+), B:\s*(\d+), A:\s*255\}/);
  assert.deepEqual([r, g, b].map(Number), rgb(gray.app.bg));
});

test('fresh, corrupt, removed, and unknown saved themes resolve to Gray', async () => {
  for (const saved of [null, '{}', '{bad json', ...['dracula', 'tokyo-night', 'catppuccin-mocha', 'missing-theme'].map(theme => JSON.stringify({ theme }))]) {
    const { mod } = settingsHarness(saved);
    await mod.loadSettings();
    assert.equal(mod.DEFAULT_SETTINGS.theme, themes.DEFAULT_THEME_ID);
    assert.equal(mod.getSettings().theme, themes.DEFAULT_THEME_ID);
    assert.equal(mod.getSettings().themeLight, false);
    assert.equal(mod.terminalTheme(mod.getSettings()).background, gray.theme.background);
  }
});

test('explicit existing themes and legacy settings are not forcibly switched', async () => {
  for (const theme of ['vercel-dark', 'graphite', 'nord', 'one-dark']) {
    const saved = JSON.stringify({ theme, font: 'jetbrains-mono', fontSize: 16, uiScale: 0.95 });
    for (const legacy of [false, true]) {
      const { mod } = settingsHarness(legacy ? null : saved, legacy ? saved : null);
      await mod.loadSettings();
      assert.equal(mod.getSettings().theme, theme);
      assert.equal(mod.getSettings().font, 'jetbrains-mono');
      assert.equal(mod.getSettings().fontSize, 16);
      assert.equal(mod.getSettings().uiScale, 0.95);
    }
  }
});

test('the Ash Gray rename migrates saved and legacy preferences without losing other settings', async () => {
  const saved = JSON.stringify({ theme: 'ash-gray', themeLight: true, fontSize: 16, sidebarWidth: 245 });
  for (const legacy of [false, true]) {
    const { mod } = settingsHarness(legacy ? null : saved, legacy ? saved : null);
    await mod.loadSettings();
    assert.equal(mod.getSettings().theme, 'gray');
    assert.equal(mod.getSettings().themeLight, true);
    assert.equal(mod.getSettings().fontSize, 16);
    assert.equal(mod.getSettings().sidebarWidth, 245);
  }
  for (const light of [false, true])
    assert.equal(themes.resolvedPreset('ash-gray', light), themes.resolvedPreset('gray', light));
});

test('selecting Gray persists only the requested preference and updates both palettes', async () => {
  const initial = JSON.parse(JSON.stringify(settingsHarness().mod.DEFAULT_SETTINGS));
  initial.theme = 'nord';
  initial.fontSize = 16;
  initial.sidebarWidth = 245;
  initial.sections.ssh = true;
  const { mod, writes, properties, flush } = settingsHarness(JSON.stringify(initial));
  await mod.loadSettings();
  let notified;
  mod.onSettingsChange(s => { notified = s.theme; });
  mod.updateSettings({ theme: themes.DEFAULT_THEME_ID });
  flush();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { ...initial, theme: themes.DEFAULT_THEME_ID });
  assert.equal(notified, themes.DEFAULT_THEME_ID);
  assert.equal(properties.get('--bg'), gray.app.bg);
  assert.equal(properties.get('--surface'), gray.app.surface);
  assert.equal(properties.get('color-scheme'), 'dark');
  assert.equal(properties.has('filter'), false);
  assert.equal(mod.terminalTheme(mod.getSettings()).green, gray.theme.green);
  mod.updateSettings({ themeLight: true });
  assert.equal(properties.get('color-scheme'), 'light');
  assert.equal(properties.get('--bg'), themes.resolvedPreset(themes.DEFAULT_THEME_ID, true).app.bg);
});

test('the removed agent engine block and its API keys are scrubbed from settings.json on load', async () => {
  const saved = {
    theme: 'nord',
    fontSize: 16,
    clearOnExit: 'all',
    engine: { providers: [{ id: 'x', apiKey: 'test-key-not-a-real-secret', models: [] }] },
  };
  const { mod, writes } = settingsHarness(JSON.stringify(saved));
  await mod.loadSettings();
  assert.equal('engine' in mod.getSettings(), false);
  assert.equal(writes.length, 1, 'rewritten right away, not on the next change');
  assert.equal(JSON.stringify(writes[0]).includes('test-key-not-a-real-secret'), false);
  assert.equal(writes[0].theme, 'nord');
  assert.equal(writes[0].fontSize, 16);
  assert.equal(writes[0].clearOnExit, 'terminals', '"chats + terminals" keeps clearing terminals');

  const chatsOnly = settingsHarness(JSON.stringify({ clearOnExit: 'chats', engine: {} }));
  await chatsOnly.mod.loadSettings();
  assert.equal(chatsOnly.mod.getSettings().clearOnExit, 'none');

  const clean = settingsHarness(JSON.stringify({ theme: 'nord', clearOnExit: 'terminals' }));
  await clean.mod.loadSettings();
  assert.equal(clean.writes.length, 0, 'a file without the old block is not rewritten');
  assert.equal(clean.mod.getSettings().clearOnExit, 'terminals');
});
