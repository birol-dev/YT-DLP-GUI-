'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource } = require('./helpers/source');

describe('Hardening Sweep (reliability + security)', () => {
  const mainCode = getMainSource();
  const foldersCode = fs.readFileSync(path.join(rootDir, 'src/main/folders.js'), 'utf8');
  const downloadsCode = fs.readFileSync(path.join(rootDir, 'src/main/downloads.js'), 'utf8');
  const gifCode = fs.readFileSync(path.join(rootDir, 'src/main/gif.js'), 'utf8');
  const browserViewCode = fs.readFileSync(path.join(rootDir, 'src/main/browser-view.js'), 'utf8');

  test('drag icon sources resolve from project root, not src/main', () => {
    assert.match(foldersCode, /path\.join\(__dirname,\s*'\.\.',\s*'\.\.',\s*'website',\s*'assets'/);
    assert.doesNotMatch(
      foldersCode,
      /path\.join\(__dirname,\s*'website',\s*'assets'/,
      'must not look for website/assets under src/main'
    );
    const favicon = path.join(rootDir, 'website', 'assets', 'favicon-32.png');
    assert.ok(fs.existsSync(favicon), 'favicon-32.png must exist at expected path');
  });

  test('open-download-folder maps subtitles/clipper/gif types to correct folders', () => {
    assert.match(foldersCode, /subtitles:\s*'yt-subs'/);
    assert.match(foldersCode, /clipper:\s*'yt-videos'/);
    assert.match(foldersCode, /gif:\s*'gif-exports'/);
    assert.match(foldersCode, /folderMap\[type\]/);
  });

  test('download spawns report ENOENT via error handlers and safeSend', () => {
    assert.match(downloadsCode, /function safeSend\s*\(/);
    assert.match(downloadsCode, /ytProcess\.on\(\s*'error'/);
    assert.match(downloadsCode, /Failed to start yt-dlp/);
    assert.match(mainCode, /Failed to start yt-dlp/);
  });

  test('GIF conversion rejects invalid duration and null-safe IPC', () => {
    assert.match(gifCode, /End time must be greater than start time/);
    assert.match(gifCode, /Invalid input path/);
    assert.match(gifCode, /safeSend|!win\.isDestroyed\(\)/);
  });

  test('media-preview refuses file URLs outside userData/downloads/temp', () => {
    assert.match(browserViewCode, /fileURLToPath/);
    assert.match(browserViewCode, /Forbidden local path/);
    assert.match(browserViewCode, /allowedRoots/);
    assert.match(browserViewCode, /app\.getPath\('userData'\)/);
  });
});
