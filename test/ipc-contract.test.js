const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource, getRendererSource } = require('./helpers/source');

describe('IPC Contract and Preload Exposure Audit', () => {
  const preloadCode = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
  const rendererCode = getRendererSource();
  const mainCode = getMainSource();

  test('all window.electronAPI method calls in renderer.js should be exposed in preload.js', () => {
    // Extract exposed properties in contextBridge
    const preloadExposedKeys = [...preloadCode.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)].map(m => m[1]);
    const exposedSet = new Set(preloadExposedKeys);

    assert.ok(preloadExposedKeys.length > 0, 'No electronAPI methods found in preload.js');

    // Extract all calls to window.electronAPI.<methodName> in renderer.js
    const rendererCalls = [...new Set([...rendererCode.matchAll(/window\.electronAPI\.([a-zA-Z0-9_]+)/g)].map(m => m[1]))];
    
    assert.ok(rendererCalls.length > 0, 'No electronAPI calls found in renderer.js');

    const missingInPreload = rendererCalls.filter(method => !exposedSet.has(method));

    assert.deepStrictEqual(
      missingInPreload,
      [],
      `The following methods are called via window.electronAPI in renderer.js but are NOT exposed in preload.js: ${missingInPreload.join(', ')}`
    );
  });

  test('all IPC channels invoked or sent in preload.js should have handlers in main.js', () => {
    // Extract all channels sent or invoked from preload.js
    const preloadChannels = [...new Set([...preloadCode.matchAll(/ipcRenderer\.(?:send|invoke)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
    
    assert.ok(preloadChannels.length > 0, 'No IPC channels found in preload.js');

    // Extract all channels handled in main.js via ipcMain.on or ipcMain.handle
    const mainChannels = [...new Set([...mainCode.matchAll(/ipcMain\.(?:on|handle)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
    const mainChannelSet = new Set(mainChannels);

    assert.ok(mainChannels.length > 0, 'No IPC handlers found in main.js');

    const unhandledChannels = preloadChannels.filter(ch => !mainChannelSet.has(ch));

    assert.deepStrictEqual(
      unhandledChannels,
      [],
      `The following IPC channels are sent from preload.js but lack handlers in main.js: ${unhandledChannels.join(', ')}`
    );
  });
});
