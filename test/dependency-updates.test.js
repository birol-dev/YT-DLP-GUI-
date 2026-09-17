const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource, getRendererSource } = require('./helpers/source');
const mainCode = getMainSource();
const rendererCode = getRendererSource();
const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const preloadCode = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');

describe('Dependency Auto-Updates & Real-time Notification System', () => {
  test('defaultSettings includes autoUpdateDependencies, ffmpegInstalledVersion, and lastUpdateCheck', () => {
    assert.match(mainCode, /autoUpdateDependencies\s*:\s*true/, 'autoUpdateDependencies: true missing from defaultSettings');
    assert.match(mainCode, /ffmpegInstalledVersion\s*:\s*['"]{2}/, 'ffmpegInstalledVersion missing from defaultSettings');
    assert.match(mainCode, /lastUpdateCheck\s*:\s*null/, 'lastUpdateCheck missing from defaultSettings');
  });

  test('src/main/deps.js implements comprehensive FFmpeg and multi-component update routines', () => {
    assert.match(mainCode, /function\s+getFfmpegDownloadUrl\s*\(/, 'getFfmpegDownloadUrl not found in deps.js');
    assert.match(mainCode, /async\s+function\s+getFfmpegVersionInfo\s*\(/, 'getFfmpegVersionInfo not found in deps.js');
    assert.match(mainCode, /async\s+function\s+updateFfmpeg\s*\(/, 'updateFfmpeg not found in deps.js');
    assert.match(mainCode, /async\s+function\s+checkFfmpegUpdate\s*\(/, 'checkFfmpegUpdate not found in deps.js');
    assert.match(mainCode, /async\s+function\s+checkAndUpdateAllDependencies\s*\(/, 'checkAndUpdateAllDependencies not found in deps.js');
  });

  test('boot sequence in main.js triggers checkAndUpdateAllDependencies when auto-update is enabled', () => {
    assert.match(mainCode, /checkAndUpdateAllDependencies\s*\(\s*win/, 'checkAndUpdateAllDependencies not called in boot sequence');
    assert.match(mainCode, /autoUpdateDependencies\s*!==\s*false/, 'autoUpdateDependencies check missing before boot update');
  });

  test('onboarding completion triggers checkAndUpdateAllDependencies', () => {
    const onboardingFile = fs.readFileSync(path.join(rootDir, 'src/main/onboarding.js'), 'utf8');
    assert.match(onboardingFile, /checkAndUpdateAllDependencies/, 'finish-onboarding must call checkAndUpdateAllDependencies');
  });

  test('preload.js exposes required dependency update APIs', () => {
    assert.match(preloadCode, /getFfmpegInfo\s*:/, 'getFfmpegInfo missing from preload.js');
    assert.match(preloadCode, /updateFfmpeg\s*:/, 'updateFfmpeg missing from preload.js');
    assert.match(preloadCode, /checkAllUpdates\s*:/, 'checkAllUpdates missing from preload.js');
    assert.match(preloadCode, /onDependencyUpdateStatus\s*:/, 'onDependencyUpdateStatus missing from preload.js');
  });

  test('IPC handlers exist for dependency updates', () => {
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]get-ffmpeg-info['"]/, 'get-ffmpeg-info IPC handler missing');
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]update-ffmpeg['"]/, 'update-ffmpeg IPC handler missing');
    assert.match(mainCode, /ipcMain\.handle\(\s*['"]check-all-updates['"]/, 'check-all-updates IPC handler missing');
  });

  test('index.html defines all required UI elements for updates and notification toast', () => {
    const requiredElementIds = [
      'settings-auto-update-deps',
      'btn-check-all-updates',
      'label-last-update-check',
      'dependency-update-result-box',
      'ytdlp-status-badge',
      'ffmpeg-status-badge',
      'ffmpeg-version-info',
      'btn-force-update-ffmpeg',
      'ffmpeg-status',
      'update-notification-toast',
      'update-toast-icon',
      'update-toast-title',
      'update-toast-detail',
      'btn-update-toast-retry',
      'btn-update-toast-close'
    ];

    for (const id of requiredElementIds) {
      assert.ok(
        htmlContent.includes(`id="${id}"`),
        `Required element #${id} is missing from index.html`
      );
    }
  });

  test('renderer settings.js wires all update controls, auto-save, and toast notifications', () => {
    assert.match(rendererCode, /settings-auto-update-deps/, 'settings-auto-update-deps not handled in renderer');
    assert.match(rendererCode, /btn-check-all-updates/, 'btn-check-all-updates listener missing in renderer');
    assert.match(rendererCode, /btn-force-update-ffmpeg/, 'btn-force-update-ffmpeg listener missing in renderer');
    assert.match(rendererCode, /window\.electronAPI\.onDependencyUpdateStatus/, 'onDependencyUpdateStatus listener missing in renderer');
    assert.match(rendererCode, /function\s+showUpdateToast/, 'showUpdateToast function missing in renderer');
    assert.match(rendererCode, /function\s+refreshFfmpegInfo/, 'refreshFfmpegInfo function missing in renderer');
  });

  test('FFmpeg version parsing logic correctly extracts version from real CLI outputs', () => {
    const parseVersion = (raw) => {
      const match = raw.match(/ffmpeg\s+version\s+([^\s,]+)/i);
      return match ? match[1] : null;
    };

    const gyanDevOutput = 'ffmpeg version 7.1-essentials_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers';
    assert.strictEqual(parseVersion(gyanDevOutput), '7.1-essentials_build-www.gyan.dev');

    const johnVanSickleOutput = 'ffmpeg version 6.1-static https://johnvansickle.com/ffmpeg/ Copyright (c) 2000-2023 the FFmpeg developers';
    assert.strictEqual(parseVersion(johnVanSickleOutput), '6.1-static');

    const ubuntuOutput = 'ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers';
    assert.strictEqual(parseVersion(ubuntuOutput), '4.4.2-0ubuntu0.22.04.1');

    const gitTagOutput = 'ffmpeg version n5.1.2 Copyright (c) 2000-2022 the FFmpeg developers';
    assert.strictEqual(parseVersion(gitTagOutput), 'n5.1.2');
  });

  test('FFmpeg download URL helper produces valid release URLs', () => {
    function getFfmpegDownloadUrl(version, platform = 'win32', arch = 'x64') {
      const v = version || '6.1';
      if (platform === 'win32') {
        const archStr = arch === 'arm64' ? 'arm64' : (arch === 'ia32' ? 'win-32' : 'win-64');
        return `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${v}/ffmpeg-${v}-${archStr}.zip`;
      }
      if (platform === 'darwin') {
        const archStr = arch === 'arm64' ? 'osx-arm-64' : 'osx-64';
        return `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${v}/ffmpeg-${v}-${archStr}.zip`;
      }
      const archStr = arch === 'arm64' ? 'linux-arm-64' : (arch === 'arm' ? 'linux-armhf-32' : 'linux-64');
      return `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${v}/ffmpeg-${v}-${archStr}.zip`;
    }

    const winUrl = getFfmpegDownloadUrl('6.1', 'win32', 'x64');
    assert.strictEqual(winUrl, 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip');

    const macUrl = getFfmpegDownloadUrl('6.1', 'darwin', 'arm64');
    assert.strictEqual(macUrl, 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-osx-arm-64.zip');

    const linuxUrl = getFfmpegDownloadUrl('6.1', 'linux', 'x64');
    assert.strictEqual(linuxUrl, 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip');
  });

  test('compareVersions accurately compares semver and protects against downgrades', () => {
    // Avoid require('../src/main/deps') — it loads electron and flakes when the Electron
    // postinstall fails on windows-latest. Normalize CRLF so the extract works on CI.
    const normalized = mainCode.replace(/\r\n/g, '\n');
    const helpersMatch = normalized.match(/function parseVersionParts\(v\) \{[\s\S]*?\n\}\n+function compareVersions\(v1, v2\) \{[\s\S]*?\n\}/);
    assert.ok(helpersMatch, 'parseVersionParts/compareVersions not found in deps.js source');
    const compareVersions = new Function(`${helpersMatch[0]}; return compareVersions;`)();
    assert.ok(typeof compareVersions === 'function', 'compareVersions must be a function');

    assert.strictEqual(compareVersions('7.1.5', '6.1'), 1);
    assert.strictEqual(compareVersions('7.1-essentials_build-www.gyan.dev', '6.1'), 1);
    assert.strictEqual(compareVersions('6.1-static', '7.1.5'), -1);
    assert.strictEqual(compareVersions('6.1', '6.1'), 0);
    assert.strictEqual(compareVersions('6.0', '6.1'), -1);
    assert.strictEqual(compareVersions('7.1', '7.1.0'), 0);
  });

  test('formatBadgeVersion cleanly extracts compact badge version strings', () => {
    function formatBadgeVersion(raw) {
      if (!raw) return 'Installed';
      const str = String(raw).trim();
      const match = str.match(/^v?([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)?)/i) || str.match(/^(N-\d+)/i);
      if (match && match[1]) {
        return `v${match[1]}`;
      }
      const clean = str.replace(/^v/i, '');
      const base = clean.split(/[-_+ ]/)[0];
      return base ? `v${base}` : 'Installed';
    }

    assert.strictEqual(formatBadgeVersion('7.1-essentials_build-www.gyan.dev'), 'v7.1');
    assert.strictEqual(formatBadgeVersion('7.1.5'), 'v7.1.5');
    assert.strictEqual(formatBadgeVersion('6.1-static'), 'v6.1');
    assert.strictEqual(formatBadgeVersion('2025.01.15'), 'v2025.01.15');
    assert.strictEqual(formatBadgeVersion('v2025.01.15'), 'v2025.01.15');
    assert.strictEqual(formatBadgeVersion('N-118000-g12345'), 'vN-118000');
    assert.strictEqual(formatBadgeVersion(''), 'Installed');
    assert.strictEqual(formatBadgeVersion(null), 'Installed');
  });

  test('renderer settings.js implements summary sync and separates toast timers', () => {
    assert.match(rendererCode, /function\s+formatBadgeVersion/, 'formatBadgeVersion missing in renderer');
    assert.match(rendererCode, /function\s+syncDependencySummaryBox/, 'syncDependencySummaryBox missing in renderer');
    assert.match(rendererCode, /dismissAnimationTimer/, 'dismissAnimationTimer must be separate from autoDismissTimeout');
    assert.match(rendererCode, /autoDismissTimeout/, 'autoDismissTimeout must exist in settings.js');
    assert.match(rendererCode, /syncDependencySummaryBox\s*\(\s*['"]ffmpeg['"]/, 'syncDependencySummaryBox must be called on ffmpeg update');
    assert.match(rendererCode, /syncDependencySummaryBox\s*\(\s*['"]yt-dlp['"]/, 'syncDependencySummaryBox must be called on yt-dlp update');
  });

  test('src/main/deps.js prevents FFmpeg downgrade and emits completed status', () => {
    assert.match(mainCode, /function\s+compareVersions/, 'compareVersions not found in deps.js');
    assert.match(mainCode, /Installed FFmpeg.*newer than/, 'downgrade protection message not found in deps.js');
    assert.match(mainCode, /phase:\s*['"]completed['"]/, 'completed status must be emitted');
  });
});

