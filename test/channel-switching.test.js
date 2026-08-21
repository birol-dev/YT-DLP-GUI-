const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const rootDir = path.resolve(__dirname, '..');
const mainCode = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
const rendererCode = fs.readFileSync(path.join(rootDir, 'renderer.js'), 'utf8');

describe('Forceful yt-dlp Channel Switching & Blocking Task Termination Audit', () => {
  test('main.js must define active process tracking and forceful termination functions', () => {
    assert.match(mainCode, /const\s+activeProcesses\s*=\s*new\s+Set\(\)/, 'activeProcesses set not found');
    assert.match(mainCode, /const\s+activeYtDlpProcesses\s*=\s*new\s+Set\(\)/, 'activeYtDlpProcesses set not found');
    assert.match(mainCode, /function\s+registerProcess\s*\(/, 'registerProcess function not found');
    assert.match(mainCode, /async\s+function\s+killProcessTree\s*\(/, 'killProcessTree function not found');
    assert.match(mainCode, /async\s+function\s+stopAllBlockingTasks\s*\(/, 'stopAllBlockingTasks function not found');
  });

  test('switchYtDlpChannel and forceUpdateYtDlp must forcefully stop blocking tasks instead of aborting', () => {
    // Verify switchYtDlpChannel calls stopAllBlockingTasks
    const switchFuncMatch = mainCode.match(/async\s+function\s+switchYtDlpChannel\s*\([\s\S]*?\n\}/);
    assert.ok(switchFuncMatch, 'switchYtDlpChannel function definition not found');
    assert.match(switchFuncMatch[0], /stopAllBlockingTasks/, 'switchYtDlpChannel must invoke stopAllBlockingTasks');
    assert.doesNotMatch(switchFuncMatch[0], /Cannot switch build while a download, search, or scan is currently in progress/, 'switchYtDlpChannel must not reject on active processes');

    // Verify forceUpdateYtDlp calls stopAllBlockingTasks
    const forceFuncMatch = mainCode.match(/async\s+function\s+forceUpdateYtDlp\s*\([\s\S]*?\n\}/);
    assert.ok(forceFuncMatch, 'forceUpdateYtDlp function definition not found');
    assert.match(forceFuncMatch[0], /stopAllBlockingTasks/, 'forceUpdateYtDlp must invoke stopAllBlockingTasks');
    assert.doesNotMatch(forceFuncMatch[0], /Cannot update yt-dlp forcefully while a download, search, or scan is in progress/, 'forceUpdateYtDlp must not reject on active processes');
  });

  test('forceUpdateYtDlp and switchYtDlpChannel must pass through IPC handlers properly', () => {
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]force-update-yt-dlp['"][\s\S]*?forceUpdateYtDlp/, 'IPC handler for force-update-yt-dlp not wired to forceUpdateYtDlp');
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]switch-yt-dlp-channel['"][\s\S]*?switchYtDlpChannel/, 'IPC handler for switch-yt-dlp-channel not wired to switchYtDlpChannel');
  });

  test('stopAllBlockingTasks must dispatch cancel events to renderer', () => {
    const stopFuncMatch = mainCode.match(/async\s+function\s+stopAllBlockingTasks\s*\([\s\S]*?\n\}/);
    assert.ok(stopFuncMatch, 'stopAllBlockingTasks definition not found');
    const body = stopFuncMatch[0];
    assert.match(body, /download-error/, 'Must notify renderer of download cancellation');
    assert.match(body, /scan-error/, 'Must notify renderer of scan cancellation');
    assert.match(body, /divide-error/, 'Must notify renderer of divide task cancellation');
    assert.match(body, /gif-finished/, 'Must notify renderer of gif task cancellation');
  });

  test('renderer.js must have click handlers for switch-yt-dlp-channel and force-update-ytdlp', () => {
    assert.match(rendererCode, /btn-switch-ytdlp-channel/, 'btn-switch-ytdlp-channel not found in renderer.js');
    assert.match(rendererCode, /btn-force-update-ytdlp/, 'btn-force-update-ytdlp not found in renderer.js');
    assert.match(rendererCode, /window\.electronAPI\.switchYtDlpChannel/, 'switchYtDlpChannel API call not found in renderer.js');
    assert.match(rendererCode, /window\.electronAPI\.forceUpdateYtDlp/, 'forceUpdateYtDlp API call not found in renderer.js');
  });

  test('process registration lifecycle unit test simulation', () => {
    const activeProcesses = new Set();
    const activeYtDlpProcesses = new Set();

    function registerProcess(proc, meta = {}) {
      if (!proc) return;
      activeProcesses.add(proc);
      if (meta.isYtDlp !== false) {
        activeYtDlpProcesses.add(proc);
      }
      const cleanUp = () => {
        activeProcesses.delete(proc);
        activeYtDlpProcesses.delete(proc);
      };
      proc.on('close', cleanUp);
      proc.on('exit', cleanUp);
      proc.on('error', cleanUp);
    }

    class MockProcess extends EventEmitter {
      constructor(pid) {
        super();
        this.pid = pid;
      }
      kill() {
        this.emit('close', 0);
      }
    }

    const proc1 = new MockProcess(101);
    const proc2 = new MockProcess(102);

    registerProcess(proc1, { isYtDlp: true });
    registerProcess(proc2, { isYtDlp: false });

    assert.strictEqual(activeProcesses.size, 2);
    assert.strictEqual(activeYtDlpProcesses.size, 1);

    proc1.kill();
    assert.strictEqual(activeProcesses.size, 1);
    assert.strictEqual(activeYtDlpProcesses.size, 0);

    proc2.kill();
    assert.strictEqual(activeProcesses.size, 0);
    assert.strictEqual(activeYtDlpProcesses.size, 0);
  });
});
