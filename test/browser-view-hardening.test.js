'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir } = require('./helpers/source');

describe('In-app browser hardening', () => {
  const browserViewCode = fs.readFileSync(path.join(rootDir, 'src/main/browser-view.js'), 'utf8');
  const browserRendererCode = fs.readFileSync(path.join(rootDir, 'renderer/browser.js'), 'utf8');
  const ytdlpCode = fs.readFileSync(path.join(rootDir, 'src/main/ytdlp.js'), 'utf8');
  const cacheCode = fs.readFileSync(path.join(rootDir, 'src/main/cache.js'), 'utf8');

  test('guest view lives in its own persistent partition, not the default session', () => {
    assert.match(browserViewCode, /GUEST_BROWSER_PARTITION\s*=\s*'persist:in-app-browser'/);
    assert.match(browserViewCode, /partition:\s*GUEST_BROWSER_PARTITION/);
    assert.match(browserViewCode, /session\.fromPartition\(GUEST_BROWSER_PARTITION\)/);
    assert.doesNotMatch(browserViewCode, /webContents\.session/, 'guest hooks must use getGuestSession()');
    assert.match(browserViewCode, /guestSession\.webRequest\.onBeforeSendHeaders/);
    assert.match(browserViewCode, /guestSession\.webRequest\.onHeadersReceived/);
    assert.match(browserViewCode, /guestSession\.setPermissionRequestHandler/);
    assert.match(browserViewCode, /ctx\.getGuestSession\s*=\s*getGuestSession/);
  });

  test('browser-clear-data only clears the guest partition', () => {
    const handler = browserViewCode.slice(browserViewCode.indexOf("ipcMain.handle('browser-clear-data'"));
    const body = handler.slice(0, handler.indexOf('});'));
    assert.match(body, /getGuestSession\(\)/);
    assert.doesNotMatch(body, /session\.defaultSession/);
  });

  test('yt-dlp cookie export and cookie test read the guest partition', () => {
    assert.doesNotMatch(ytdlpCode, /session\.defaultSession\.cookies/);
    assert.match(ytdlpCode, /getGuestSession\(\)/);
    assert.match(ytdlpCode, /getInAppBrowserCookies\(\)/);
  });

  test('one-time cookie migration is guarded by a marker file', () => {
    assert.match(browserViewCode, /in-app-browser-session-migrated\.json/);
    assert.match(browserViewCode, /session\.defaultSession\.cookies\.get\(\{\}\)/);
    assert.match(browserViewCode, /guestCookies\.set\(details\)/);
  });

  test('media-preview forwards Range and fetches through the guest session', () => {
    assert.match(browserViewCode, /request\.headers\.get\('range'\)/);
    assert.match(browserViewCode, /session:\s*getGuestSession\(\)/);
    assert.match(browserViewCode, /'content-range'/);
    assert.match(browserViewCode, /OPTIONS/);
  });

  test('detected-media dedupe cache is reset with the renderer list', () => {
    assert.match(browserViewCode, /detectedMediaUrlCache\.clear\(\)/);
    assert.match(browserViewCode, /clear-detected-media/);
    assert.match(browserRendererCode, /browserViewControl\('clear-detected-media'\)/);
    assert.match(cacheCode, /clear\(\)\s*\{/);
  });

  test('sniffer list escapes every external value before innerHTML', () => {
    assert.match(browserRendererCode, /import \{ escapeHtml, safeHttpUrl \} from '\.\/html\.js'/);
    assert.doesNotMatch(browserRendererCode, /\$\{displayTitle\}/);
    assert.doesNotMatch(browserRendererCode, /\$\{media\.url\}/);
    assert.doesNotMatch(browserRendererCode, /\$\{probedData\./);
    assert.match(browserRendererCode, /escapeHtml\(displayTitle\)/);
    assert.match(browserRendererCode, /escapeHtml\(media\.url\)/);
  });

  test('download-media-stream never uses manifest extensions as output and registers the process group', () => {
    assert.match(browserViewCode, /function pickStreamOutput\(/);
    assert.match(browserViewCode, /libmp3lame/);
    assert.match(browserViewCode, /registerProcess\(proc,\s*\{\s*isYtDlp:\s*false,\s*group:\s*'download'\s*\}\)/);
    assert.match(browserViewCode, /code === null/);
  });

  test('hls.js is pinned, integrity-checked, and routed through media-preview', () => {
    assert.doesNotMatch(browserRendererCode, /hls\.js@latest/);
    assert.match(browserRendererCode, /hls\.js@\$\{HLS_JS_VERSION\}\/dist\/hls\.min\.js/);
    assert.match(browserRendererCode, /HLS_JS_VERSION\s*=\s*'\d+\.\d+\.\d+'/);
    assert.match(browserRendererCode, /sha384-[A-Za-z0-9+/]{64}/);
    assert.doesNotMatch(browserRendererCode, /setRequestHeader\('(User-Agent|Referer)'/);
    assert.match(browserRendererCode, /createMediaPreviewHlsLoader\(window\.Hls,\s*pageUrl\)/);
  });

  test('runYtDlpProcess tags probes with a process group', () => {
    assert.match(ytdlpCode, /registerYtDlpProcess\(proc,\s*\{\s*group\s*\}\)/);
  });
});
