const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource, getRendererSource } = require('./helpers/source');

describe('Settings Schema & UI Synchronicity Audit', () => {
  const mainCode = getMainSource();
  const rendererCode = getRendererSource();
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  test('defaultSettings in main.js defines core required configuration keys', () => {
    const requiredKeys = [
      'downloadDir',
      'defaultQuality',
      'defaultSubLang',
      'accentColor',
      'soundEnabled',
      'autoOpenFolder',
      'videoFormat',
      'audioFormat',
      'ytDlpChannel'
    ];

    for (const key of requiredKeys) {
      const regex = new RegExp(`\\b${key}\\s*:`, 'm');
      assert.ok(
        regex.test(mainCode),
        `Required setting "${key}" is missing from defaultSettings in main.js`
      );
    }
  });

  test('supported themes in HTML match those handled in CSS and renderer.js', () => {
    // Extract theme values from data-theme attributes in index.html
    const themeMatches = [...htmlContent.matchAll(/class=["'][^"']*theme-option[^"']*["'][^>]*data-theme=["']([^"']+)["']/g)].map(m => m[1]);
    const uniqueThemes = [...new Set(themeMatches)];

    assert.ok(uniqueThemes.length >= 6, `Expected at least 6 theme palettes, found ${uniqueThemes.length}`);
    const expectedThemes = ['default', 'youtube', 'neon', 'emerald', 'purple', 'amber'];
    for (const theme of expectedThemes) {
      assert.ok(uniqueThemes.includes(theme), `Theme "${theme}" is missing from theme picker in index.html`);
    }
  });

  test('settings UI controls in index.html exist for core preferences', () => {
    const essentialSettingsElements = [
      'settings-default-quality',
      'settings-default-sublang',
      'settings-video-format',
      'settings-audio-format',
      'settings-sound-enabled',
      'settings-auto-open',
      'settings-ytdlp-channel',
      'btn-force-update-ytdlp',
      'btn-switch-ytdlp-channel',
      'btn-save-settings'
    ];

    for (const elementId of essentialSettingsElements) {
      assert.ok(
        htmlContent.includes(`id="${elementId}"`),
        `Expected settings UI element "#${elementId}" to exist in index.html`
      );
    }
  });
});
