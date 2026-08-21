const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Package & Config Integrity', () => {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');

  test('package.json must contain required start, dev, and test scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    assert.ok(pkg.scripts, 'scripts block missing in package.json');
    assert.ok(pkg.scripts.start, 'scripts.start missing in package.json');
    assert.ok(pkg.scripts.dev, 'scripts.dev missing in package.json');
    assert.ok(pkg.scripts.test, 'scripts.test missing in package.json');
    assert.strictEqual(pkg.main, 'main.js', 'main entrypoint must be main.js');
  });

  test('package.json version should match the latest entry in CHANGELOG.md', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const changelog = fs.readFileSync(changelogPath, 'utf8');

    const changelogVersionMatch = changelog.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
    assert.ok(changelogVersionMatch, 'Could not find version header in CHANGELOG.md');

    const latestChangelogVersion = changelogVersionMatch[1];
    assert.strictEqual(
      pkg.version,
      latestChangelogVersion,
      `package.json version (${pkg.version}) does not match latest CHANGELOG.md version (${latestChangelogVersion})`
    );
  });
});
