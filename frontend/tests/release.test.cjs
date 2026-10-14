const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));

test('app, package, lockfile, and release notes share one version', () => {
  const version = json('wails.json').info.productVersion;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(json('frontend/package.json').version, version);
  const lock = json('frontend/package-lock.json');
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  const resources = json('build/windows/info.json');
  assert.equal(resources.fixed.file_version, '{{.Info.ProductVersion}}');
  assert.equal(resources.info['0409'].FileVersion, '{{.Info.ProductVersion}}');
  assert.equal(resources.info['0409'].ProductVersion, '{{.Info.ProductVersion}}');
  const notes = read(`docs/releases/v${version}.md`);
  assert.ok(notes.includes(`Ash-Setup-v${version}.exe`));
  assert.ok(notes.includes('SHA256SUMS.txt'));
  assert.ok(read('CHANGELOG.md').includes(`## ${version}`));
});

test('installer and uninstall never wipe the install directory or user preferences', () => {
  const installer = read('build/windows/installer/project.nsi');
  assert.match(installer, /!define PRODUCT_EXECUTABLE\s+"Ash\.exe"/);
  assert.match(installer, /!insertmacro wails\.files/);
  assert.match(installer, /Call EnsureAppClosed/);
  assert.match(installer, /Call un\.EnsureAppClosed/);
  assert.match(installer, /Gray theme as the default for new profiles/);
  assert.doesNotMatch(installer, /RMDir\s+\/r\s+"?\$(?:INSTDIR|PROGRAMFILES64)/i);
  assert.doesNotMatch(installer, /(?:RMDir|Delete)\s+[^\r\n]*\\\.ash/i);
  assert.doesNotMatch(installer, /taskkill|Stop-Process|nsProcess::KillProcess/i);
  assert.match(installer, /RMDir "\$INSTDIR"/);
});

test('release keeps installer primary, stable update filename, checksums, and verification gates', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.ok(workflow.indexOf('Frontend regression checks') < workflow.indexOf('Publish release'));
  assert.ok(workflow.indexOf('Go regression checks') < workflow.indexOf('Publish release'));
  assert.ok(workflow.indexOf('Go static checks') < workflow.indexOf('Publish release'));
  assert.match(workflow, /wails build -nsis/);
  assert.match(workflow, /app\.Version=/);
  assert.match(workflow, /app\.Commit=/);
  assert.match(workflow, /app\.BuildChannel=release/);
  assert.match(workflow, /staging\/Ash-Setup-v\*\.exe/);
  assert.match(workflow, /staging\/Ash\.exe/);
  assert.match(workflow, /staging\/SHA256SUMS\.txt/);
  assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
  assert.match(workflow, /VersionInfo\.ProductVersion/);
  assert.match(read('internal/app/updater.go'), /ghOwner\s*= "sqweeet"/);
  assert.match(read('internal/app/updater.go'), /assetName\s*= "Ash\.exe"/);
  assert.ok(read('README.md').includes('**Download') || read('README.md').includes('**[Download the Windows installer]'));
});
