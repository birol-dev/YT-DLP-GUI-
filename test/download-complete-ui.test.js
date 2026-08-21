const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Download Complete UI & Open Folder Button Audit', () => {
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const rendererCode = fs.readFileSync(path.join(rootDir, 'renderer.js'), 'utf8');
  const cssContent = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  test('every download tab in index.html defines a download complete card with an open folder button', () => {
    const downloadTabs = [
      {
        tabId: 'video-tab',
        cardId: 'video-download-complete-card',
        openFolderBtnId: 'btn-video-open-folder'
      },
      {
        tabId: 'audio-tab',
        cardId: 'audio-download-complete-card',
        openFolderBtnId: 'btn-audio-open-folder'
      },
      {
        tabId: 'instagram-tab',
        cardId: 'instagram-download-complete-card',
        openFolderBtnId: 'btn-instagram-open-folder'
      },
      {
        tabId: 'subtitles-tab',
        cardId: 'subtitles-download-complete-card',
        openFolderBtnId: 'btn-subtitles-open-folder'
      },
      {
        tabId: 'clipper-tab',
        cardId: 'clipper-download-complete-card',
        openFolderBtnId: 'btn-clipper-open-folder'
      },
      {
        tabId: 'divider-tab',
        cardId: 'divider-result-box',
        openFolderBtnId: 'btn-divider-open-folder'
      },
      {
        tabId: 'gif-tab',
        cardId: 'gif-results-container',
        openFolderBtnId: 'btn-gif-open-folder'
      }
    ];

    for (const tab of downloadTabs) {
      assert.ok(
        htmlContent.includes(`id="${tab.tabId}"`),
        `Tab container #${tab.tabId} should exist in index.html`
      );
      assert.ok(
        htmlContent.includes(`id="${tab.cardId}"`),
        `Completion container #${tab.cardId} should exist in index.html`
      );
      assert.ok(
        htmlContent.includes(`id="${tab.openFolderBtnId}"`),
        `Open folder button #${tab.openFolderBtnId} should exist in index.html`
      );
    }
  });

  test('download complete cards have full action controls (Open Folder, Open File, Copy Path, Dismiss)', () => {
    const cardPrefixes = ['video', 'audio', 'instagram', 'subtitles', 'clipper'];

    for (const prefix of cardPrefixes) {
      const requiredElements = [
        `${prefix}-download-complete-card`,
        `${prefix}-complete-badge`,
        `btn-${prefix}-dismiss-complete`,
        `${prefix}-complete-thumb-wrap`,
        `${prefix}-complete-title`,
        `${prefix}-complete-path`,
        `btn-${prefix}-open-folder`,
        `btn-${prefix}-open-file`,
        `btn-${prefix}-copy-path`
      ];

      for (const elId of requiredElements) {
        assert.ok(
          htmlContent.includes(`id="${elId}"`),
          `Expected element #${elId} to exist in index.html`
        );
      }
    }
  });

  test('renderer.js manages download complete cards state and wires open folder actions', () => {
    assert.ok(
      rendererCode.includes('showDownloadCompleteCard'),
      'renderer.js should define showDownloadCompleteCard helper'
    );
    assert.ok(
      rendererCode.includes('hideDownloadCompleteCard'),
      'renderer.js should define hideDownloadCompleteCard helper'
    );
    assert.ok(
      rendererCode.includes('downloadCompleteCards'),
      'renderer.js should define downloadCompleteCards dictionary'
    );
    assert.ok(
      rendererCode.includes('window.electronAPI.onDownloadComplete'),
      'renderer.js should subscribe to onDownloadComplete'
    );
    assert.ok(
      rendererCode.includes('window.electronAPI.openFolder'),
      'renderer.js should invoke window.electronAPI.openFolder'
    );
  });

  test('styles.css contains rules for download-complete-card and button actions', () => {
    assert.ok(
      cssContent.includes('.download-complete-card'),
      'styles.css must contain .download-complete-card class'
    );
    assert.ok(
      cssContent.includes('.btn-open-folder'),
      'styles.css must contain .btn-open-folder class'
    );
    assert.ok(
      cssContent.includes('.btn-open-file'),
      'styles.css must contain .btn-open-file class'
    );
    assert.ok(
      cssContent.includes('.btn-copy-path'),
      'styles.css must contain .btn-copy-path class'
    );
    assert.ok(
      cssContent.includes('@keyframes downloadCardPop'),
      'styles.css must contain @keyframes downloadCardPop animation'
    );
  });

  test('active download progress card defines thumbnail, format badge, title, and live stats', () => {
    const activeElements = [
      'download-progress-container',
      'active-download-thumb-wrap',
      'active-download-thumb',
      'active-download-icon',
      'active-download-badge',
      'active-download-title',
      'progress-status-text',
      'active-download-stats',
      'progress-percent-text',
      'progress-substatus-text',
      'progress-fill'
    ];

    for (const elId of activeElements) {
      assert.ok(
        htmlContent.includes(`id="${elId}"`),
        `Expected active download element #${elId} to exist in index.html`
      );
    }

    assert.ok(
      rendererCode.includes('updateActiveDownloadBanner'),
      'renderer.js must define updateActiveDownloadBanner'
    );
    assert.ok(
      rendererCode.includes('activeDownloadInfo'),
      'renderer.js must maintain activeDownloadInfo state'
    );
    assert.ok(
      cssContent.includes('.active-download-card'),
      'styles.css must contain .active-download-card styling'
    );
  });
});
