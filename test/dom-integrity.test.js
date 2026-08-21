const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('DOM & UI Element Integrity Audit', () => {
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const rendererCode = fs.readFileSync(path.join(rootDir, 'renderer.js'), 'utf8');

  test('all document.getElementById IDs in renderer.js should exist in index.html', () => {
    // Extract document.getElementById('id') calls
    const idMatches = [...rendererCode.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    const uniqueIds = [...new Set(idMatches)];

    assert.ok(uniqueIds.length > 0, 'No document.getElementById calls found in renderer.js');

    // Extract all id="..." attributes in index.html
    const htmlIds = new Set([...htmlContent.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));

    const missingIds = uniqueIds.filter(id => !htmlIds.has(id));

    assert.deepStrictEqual(
      missingIds,
      [],
      `The following element IDs are queried in renderer.js but do NOT exist in index.html: ${missingIds.join(', ')}`
    );
  });

  test('all navigation button data-tab targets should correspond to defined tab views', () => {
    // Extract data-tab attributes from nav buttons in index.html
    const navTabs = [...htmlContent.matchAll(/class=["'][^"']*nav-btn[^"']*["'][^>]*data-tab=["']([^"']+)["']/g)].map(m => m[1]);
    assert.ok(navTabs.length > 0, 'No navigation tabs found in index.html');

    // Extract all tab IDs (usually matching id="<data-tab>")
    const htmlIds = new Set([...htmlContent.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));

    const missingTabs = navTabs.filter(tabId => !htmlIds.has(tabId));

    assert.deepStrictEqual(
      missingTabs,
      [],
      `The following navigation tabs do not have matching tab containers in index.html: ${missingTabs.join(', ')}`
    );
  });
});
