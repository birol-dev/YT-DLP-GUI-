const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource, getRendererSource } = require('./helpers/source');
const { extractStreamUrls } = require('../src/main/clipper');

describe('Clipper Stream Extraction & Layout Audit', () => {
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const cssContent = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const rendererCode = getRendererSource();

  test('extractStreamUrls extracts video and audio streams when combined format is missing', () => {
    const mockJson = {
      formats: [
        { format_id: '137', vcodec: 'avc1.640028', acodec: 'none', ext: 'mp4', height: 1080, url: 'https://video-1080p.mp4' },
        { format_id: '136', vcodec: 'avc1.4d401f', acodec: 'none', ext: 'mp4', height: 720, url: 'https://video-720p.mp4' },
        { format_id: '134', vcodec: 'avc1.4d401e', acodec: 'none', ext: 'mp4', height: 360, url: 'https://video-360p.mp4' },
        { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', url: 'https://audio-140.m4a' },
        { format_id: '251', vcodec: 'none', acodec: 'opus', ext: 'webm', url: 'https://audio-251.webm' }
      ]
    };

    const urls = extractStreamUrls(mockJson);
    assert.ok(urls.streamUrl, 'Must find a video stream URL');
    assert.ok(urls.audioUrl, 'Must find an audio stream URL');
    // Prefer 360p avc1 for rapid preview scrubbing
    assert.strictEqual(urls.streamUrl, 'https://video-360p.mp4');
    assert.strictEqual(urls.audioUrl, 'https://audio-140.m4a');
  });

  test('extractStreamUrls handles single combined format fallback', () => {
    const mockJson = {
      url: 'https://combined-direct.mp4',
      formats: [
        { format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', ext: 'mp4', height: 360, url: 'https://combined.mp4' }
      ]
    };

    const urls = extractStreamUrls(mockJson);
    assert.strictEqual(urls.streamUrl, 'https://combined.mp4');
    assert.strictEqual(urls.audioUrl, '');
  });

  test('index.html contains companion clipper-audio-player and unconstrained completion card', () => {
    assert.ok(
      htmlContent.includes('id="clipper-audio-player"'),
      'index.html must define #clipper-audio-player element'
    );

    // Verify clipper-download-complete-card is not trapped inside #clipper-workspace
    const workspaceIdx = htmlContent.indexOf('id="clipper-workspace"');
    const cardIdx = htmlContent.indexOf('id="clipper-download-complete-card"');
    assert.ok(workspaceIdx !== -1 && cardIdx !== -1, 'Both elements must exist');
    assert.ok(cardIdx > workspaceIdx, 'Download complete card must appear after clipper workspace');
    
    // Check that cardIdx is after the closing of #clipper-workspace
    const htmlAfterCard = htmlContent.substring(cardIdx);
    assert.ok(
      htmlAfterCard.includes('</section>'),
      'Card must be inside #clipper-tab before closing tag'
    );
  });

  test('styles.css gives clipper-tab bottom padding to prevent card truncation', () => {
    assert.match(
      cssContent,
      /#clipper-tab\s*\{[\s\S]*padding-bottom:\s*3rem/,
      'styles.css must give #clipper-tab padding-bottom: 3rem'
    );
  });

  test('renderer clipper synchronizes video and audio playback', () => {
    assert.ok(
      rendererCode.includes('clipperAudio'),
      'renderer must track clipperAudio'
    );
    assert.ok(
      rendererCode.includes('clipperAudio.play()'),
      'renderer must play companion audio'
    );
    assert.ok(
      rendererCode.includes('clipperAudio.pause()'),
      'renderer must pause companion audio'
    );
  });
});
