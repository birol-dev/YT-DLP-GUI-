const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

describe('JavaScript Syntax & Compilation Integrity', () => {
  // Core application files
  const coreFiles = ['main.js', 'preload.js', 'renderer.js'];

  for (const file of coreFiles) {
    test(`should compile without syntax errors: ${file}`, () => {
      const filePath = path.join(rootDir, file);
      assert.strictEqual(fs.existsSync(filePath), true, `File does not exist: ${file}`);
      
      const code = fs.readFileSync(filePath, 'utf8');
      assert.ok(code.length > 0, `File is empty: ${file}`);

      // 1. Full V8 script compilation
      assert.doesNotThrow(() => {
        new vm.Script(code, { filename: file });
      }, `SyntaxError encountered while parsing ${file}`);
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
