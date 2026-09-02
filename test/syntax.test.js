const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { rootDir, getAppJsFiles } = require('./helpers/source');

describe('JavaScript Syntax & Compilation Integrity', () => {
  const appFiles = getAppJsFiles().map((filePath) => path.relative(rootDir, filePath));

  assert.ok(appFiles.includes('main.js'), 'main.js must be syntax-checked');
  assert.ok(appFiles.includes('preload.js'), 'preload.js must be syntax-checked');
  assert.ok(appFiles.some((f) => f.startsWith('src/main') || f.startsWith('src' + path.sep + 'main')), 'main process modules must be syntax-checked');
  assert.ok(appFiles.some((f) => f.startsWith('renderer') && f.endsWith('.js')), 'renderer modules must be syntax-checked');

  for (const file of appFiles) {
    test(`should compile without syntax errors: ${file}`, () => {
      const filePath = path.join(rootDir, file);
      assert.strictEqual(fs.existsSync(filePath), true, `File does not exist: ${file}`);

      const code = fs.readFileSync(filePath, 'utf8');
      assert.ok(code.length > 0, `File is empty: ${file}`);

      const isEsm = /(?:^|\n)\s*(?:import\s|export\s)/.test(code);
      if (isEsm) {
        const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
          input: code,
          encoding: 'utf8'
        });
        assert.strictEqual(
          result.status,
          0,
          `SyntaxError while parsing ${file}: ${result.stderr || result.stdout}`
        );
      } else {
        assert.doesNotThrow(() => {
          new vm.Script(code, { filename: file });
        }, `SyntaxError encountered while parsing ${file}`);
      }
    });
  }

  test('syntax checker must catch unclosed functions and malformed blocks', () => {
    const brokenCode = `
      function broken() {
        console.log("missing closing brace");
    `;

    assert.throws(() => {
      new vm.Script(brokenCode, { filename: 'broken-snippet.js' });
    }, /SyntaxError/);
  });
});
