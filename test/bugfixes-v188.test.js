const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Linux Live-Test Log Bugfix Audit (v1.8.8)', () => {
  const mainCode = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
  const preloadCode = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
  const rendererCode = fs.readFileSync(path.join(rootDir, 'renderer.js'), 'utf8');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const cssContent = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  test('1. Linux Open Folder & File Reveal handles directories and avoids $HOME jump bug', () => {
    assert.match(mainCode, /function openFolderOrRevealItem\s*\(/, 'main.js must define openFolderOrRevealItem');
    assert.match(mainCode, /function openDirectoryDirectly\s*\(/, 'main.js must define openDirectoryDirectly');
    assert.match(mainCode, /getLinuxFileManager\s*\(/, 'main.js must define getLinuxFileManager for Linux native file manager detection');
    
    // Check supported Linux file managers
    assert.ok(mainCode.includes('nautilus') && mainCode.includes('dolphin') && mainCode.includes('thunar'), 'Must support standard Linux file managers');
    
    // ipcMain.on('open-folder') should use openFolderOrRevealItem
    assert.match(mainCode, /ipcMain\.on\(\s*['"]open-folder['"],\s*\(event,\s*filePath\)\s*=>\s*\{\s*openFolderOrRevealItem\(filePath\);/);
    
    // open-download-folder should use openDirectoryDirectly
    assert.match(mainCode, /openDirectoryDirectly\(targetDir\)/);
  });

  test('2. Subtitles downloader does not use greedy .* and treats written files on disk as success', () => {
    // Check that greedy sub-langs is gone
    assert.doesNotMatch(mainCode, /`\$\{subLang\}\.\*`/, 'main.js must NOT use greedy ${subLang}.* which triggers HTTP 429');
    
    // Check scoped language arguments
    assert.ok(mainCode.includes('${subLang},${subLang}-orig,${subLang}-${subLang}'), 'main.js must use scoped sub-langs arguments');
    assert.ok(mainCode.includes('no-live-chat'), 'main.js must include no-live-chat compat option');
    
    // Check close handler verifies file on disk
    assert.match(mainCode, /hasSubtitleFile\s*=\s*!!\s*\(finalPath\s*&&\s*fs\.existsSync\(finalPath\)\)/, 'main.js must check if subtitle file exists on disk');
    assert.match(mainCode, /if\s*\(code === 0 \|\| hasSubtitleFile\)/, 'main.js must treat existing subtitle file as success');
  });

  test('3. Clipper tab layout is unconstrained and completion card scrolls into view', () => {
    // In index.html, #clipper-tab should not be locked with h-full
    assert.doesNotMatch(htmlContent, /id=["']clipper-tab["']\s+class=["'][^"']*h-full/, '#clipper-tab must not have h-full class');
    
    // showDownloadCompleteCard in renderer.js should call scrollIntoView
    assert.match(rendererCode, /elements\.card\.scrollIntoView\(\s*\{\s*behavior:\s*['"]smooth['"],\s*block:\s*['"]nearest['"]\s*\}\s*\)/, 'showDownloadCompleteCard must call scrollIntoView');
  });

  test('4. Force Update yt-dlp provides loading spinner, status toast, and source tag', () => {
    assert.match(rendererCode, /btnForceUpdateYtDlp\.innerHTML\s*=\s*`[\s\S]*loading-spinner[\s\S]*Updating\.\.\./, 'btnForceUpdateYtDlp must render updating spinner');
    assert.match(rendererCode, /showSaveIndicator\([^)]*yt-dlp updated/, 'btnForceUpdateYtDlp must call showSaveIndicator toast on success');
    assert.match(mainCode, /source:\s*['"]force-update['"]/, 'main.js must send source: force-update on channel changed');
  });

  test('5. Empty URL validation provides visual shake and terminal warning across all download inputs', () => {
    assert.match(rendererCode, /function validateUrlInput\s*\(/, 'renderer.js must define validateUrlInput');
    assert.match(cssContent, /\.input-error-shake/, 'styles.css must define .input-error-shake');
    assert.match(cssContent, /@keyframes inputShake/, 'styles.css must define @keyframes inputShake');
    
    // Check validation is used on video, audio, subs, instagram, and clipper
    assert.match(rendererCode, /validateUrlInput\(inputEl,\s*['"]YouTube video URL['"]\)/);
    assert.match(rendererCode, /validateUrlInput\(inputEl,\s*['"]YouTube audio URL['"]\)/);
    assert.match(rendererCode, /validateUrlInput\(inputEl,\s*['"]YouTube subtitles URL['"]\)/);
    assert.match(rendererCode, /validateUrlInput\(inputEl,\s*['"]Instagram URL['"]\)/);
    assert.match(rendererCode, /validateUrlInput\(clipperUrlInput,\s*['"]YouTube video URL['"]\)/);
  });

  test('6. Native clipboard IPC provides reliable Copy Path feedback', () => {
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]copy-to-clipboard['"],\s*async\s*\(_event,\s*text\)\s*=>\s*\{\s*if\s*\(typeof text === 'string'\)\s*\{\s*clipboard\.writeText\(text\);/);
    assert.match(preloadCode, /copyToClipboard:\s*\(text\)\s*=>\s*ipcRenderer\.invoke\(['"]copy-to-clipboard['"],\s*text\)/);
    assert.match(rendererCode, /function flashCopyPathButton\s*\(/);
    assert.match(rendererCode, /flashCopyPathButton\(elements\.copyPath\);\s*copyTextToClipboard\(filePath\)/);
    assert.match(rendererCode, /copy-path-copied-label">Copied!</);
    assert.match(cssContent, /\.btn-copy-path\.is-copied/);
  });

  test('7. Active download progress card includes working Cancel button and IPC', () => {
    assert.match(htmlContent, /id=["']btn-cancel-download["']/, 'index.html must contain #btn-cancel-download');
    assert.match(cssContent, /\.btn-cancel-download/, 'styles.css must contain .btn-cancel-download styles');
    assert.match(preloadCode, /cancelDownload:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]cancel-download['"]\)/);
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]cancel-download['"],\s*async\s*\(event\)\s*=>\s*\{/);
    assert.match(rendererCode, /btnCancelDownload\.addEventListener\(\s*['"]click['"]/);
  });

  test('8. Divider Equal Chunks clarifies keyframe-aligned estimation and reports exact file count', () => {
    assert.match(htmlContent, /Est:\s*<span id=["']divider-chunks-preview-count["'][^>]*>0<\/span>\s*files\s*\(keyframe-aligned\)/);
    assert.match(rendererCode, /Video Divided Successfully!\s*\(\$\{countLabel\}\)/);
  });

  test('9. Clipper preview configures webRequest headers and supports local files', () => {
    assert.match(mainCode, /session\.defaultSession\.webRequest\.onBeforeSendHeaders/, 'defaultSession must set onBeforeSendHeaders for YouTube CDN');
    assert.match(mainCode, /session\.defaultSession\.webRequest\.onHeadersReceived/, 'defaultSession must set onHeadersReceived for CORS');
    assert.match(mainCode, /fs\.existsSync\(cleanUrl\)/, 'fetch-video-info must check for existing local file');
  });
});
