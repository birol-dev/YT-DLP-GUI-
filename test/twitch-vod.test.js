const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir, getMainSource, getRendererSource } = require('./helpers/source');
const {
  parseTwitchTimeParam,
  classifyTwitchUrl,
  buildTwitchQualities,
  findTwitchAudioFormat,
  pickTwitchPreviewUrl,
  normalizeTwitchChapters,
  resolveTwitchRange,
  buildTwitchDownloadArgs,
  parseFfmpegProgressLine,
  formatSectionProgressLine,
  isYtDlpStatusLine,
  describeTwitchError
} = require('../src/main/twitch-helpers');

// Shape mirrors a real `yt-dlp --dump-json` response for a Twitch past broadcast
const mockVod = {
  id: 'v2890199404',
  duration: 43770,
  formats: [
    { format_id: 'sb0', format_note: 'storyboard', ext: 'mhtml', height: 124, vcodec: 'none', acodec: 'none', url: 'https://cdn/sb0' },
    { format_id: 'Audio_Only', ext: 'mp4', tbr: 317.5, vcodec: 'none', acodec: 'mp4a.40.2', protocol: 'm3u8_native', url: 'https://cdn/audio.m3u8' },
    { format_id: '160p', ext: 'mp4', height: 160, width: 284, fps: 30, tbr: 280.8, vcodec: 'avc1.4D400C', acodec: 'mp4a.40.2', url: 'https://cdn/160p.m3u8' },
    { format_id: '360p', ext: 'mp4', height: 360, width: 640, fps: 30, tbr: 654.7, vcodec: 'avc1.4D401E', acodec: 'mp4a.40.2', url: 'https://cdn/360p.m3u8' },
    { format_id: '480p', ext: 'mp4', height: 480, width: 852, fps: 30, tbr: 1427.9, vcodec: 'avc1.4D401F', acodec: 'mp4a.40.2', url: 'https://cdn/480p.m3u8' },
    { format_id: '720p', ext: 'mp4', height: 720, width: 1280, fps: 30, tbr: 2256.3, vcodec: 'avc1.4D401F', acodec: 'mp4a.40.2', url: 'https://cdn/720p.m3u8' },
    { format_id: '720p60', ext: 'mp4', height: 720, width: 1280, fps: 60, tbr: 3015.4, vcodec: 'avc1.4D4020', acodec: 'mp4a.40.2', url: 'https://cdn/720p60.m3u8' },
    { format_id: '1080p60', format_note: 'Source', ext: 'mp4', height: 1080, width: 1920, fps: 60, tbr: 6494.8, vcodec: 'avc1.64002A', acodec: 'mp4a.40.2', url: 'https://cdn/1080p60.m3u8' }
  ],
  chapters: [
    { start_time: 0, end_time: 5751, title: 'Titanfall 2' },
    { start_time: 5751, end_time: 7931, title: 'VHOLUME' },
    { start_time: 7931, end_time: 50000, title: 'Past the end' }
  ]
};

describe('Twitch VOD Downloader', () => {
  describe('URL classification', () => {
    test('recognises VOD URLs in all common shapes and normalises them', () => {
      const expected = 'https://www.twitch.tv/videos/2890199404';
      const inputs = [
        'https://www.twitch.tv/videos/2890199404',
        'twitch.tv/videos/2890199404',
        'https://m.twitch.tv/videos/2890199404?filter=archives',
        'https://www.twitch.tv/gamesdonequick/v/2890199404',
        'https://www.twitch.tv/gamesdonequick/video/2890199404',
        'https://player.twitch.tv/?video=v2890199404&parent=example.com',
        '2890199404',
        'v2890199404'
      ];
      for (const input of inputs) {
        const res = classifyTwitchUrl(input);
        assert.strictEqual(res.kind, 'vod', `expected VOD for ${input}`);
        assert.strictEqual(res.url, expected, `unexpected normalised URL for ${input}`);
      }
    });

    test('reads the ?t= timestamp as the starting in point', () => {
      assert.strictEqual(classifyTwitchUrl('https://www.twitch.tv/videos/123456789?t=1h35m51s').startSeconds, 5751);
      assert.strictEqual(parseTwitchTimeParam('95m'), 5700);
      assert.strictEqual(parseTwitchTimeParam('42s'), 42);
      assert.strictEqual(parseTwitchTimeParam('120'), 120);
      assert.strictEqual(parseTwitchTimeParam('garbage'), 0);
    });

    test('recognises clips, and rejects channels and non-Twitch hosts', () => {
      assert.strictEqual(classifyTwitchUrl('https://clips.twitch.tv/FunnySlugName-abc123').kind, 'clip');
      assert.strictEqual(classifyTwitchUrl('https://www.twitch.tv/somechannel/clip/FunnySlugName-abc123').url, 'https://clips.twitch.tv/FunnySlugName-abc123');
      assert.strictEqual(classifyTwitchUrl('https://www.twitch.tv/somechannel').kind, 'channel');
      assert.strictEqual(classifyTwitchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').kind, 'invalid');
      assert.strictEqual(classifyTwitchUrl('https://eviltwitch.tv/videos/123456789').kind, 'invalid');
      assert.strictEqual(classifyTwitchUrl('').kind, 'invalid');
    });
  });

  describe('Format parsing', () => {
    test('builds a best-first resolution list without storyboards or audio-only', () => {
      const qualities = buildTwitchQualities(mockVod);
      assert.deepStrictEqual(qualities.map((q) => q.id), ['1080p60', '720p60', '720p', '480p', '360p', '160p']);
      assert.deepStrictEqual(qualities.map((q) => q.label), ['1080p60', '720p60', '720p', '480p', '360p', '160p']);
      assert.strictEqual(qualities[0].isSource, true);
      assert.strictEqual(qualities.filter((q) => q.isSource).length, 1);
    });

    test('flags the top rendition as Source when Twitch does not label one', () => {
      const clip = { formats: [
        { format_id: '480', height: 480, fps: 30, url: 'https://cdn/480.mp4' },
        { format_id: '1080', height: 1080, fps: 60, url: 'https://cdn/1080.mp4' }
      ] };
      const qualities = buildTwitchQualities(clip);
      assert.strictEqual(qualities[0].id, '1080');
      assert.strictEqual(qualities[0].isSource, true);
      assert.strictEqual(qualities[0].label, '1080p60');
    });

    test('finds the audio-only rendition and a light preview stream', () => {
      assert.deepStrictEqual(findTwitchAudioFormat(mockVod), { id: 'Audio_Only', tbr: 317.5 });
      assert.strictEqual(pickTwitchPreviewUrl(mockVod), 'https://cdn/480p.m3u8');
      assert.strictEqual(findTwitchAudioFormat({ formats: [] }), null);
    });

    test('normalises chapters and clamps them to the VOD duration', () => {
      const chapters = normalizeTwitchChapters(mockVod, mockVod.duration);
      assert.strictEqual(chapters.length, 3);
      assert.deepStrictEqual(chapters[1], { title: 'VHOLUME', start: 5751, end: 7931 });
      assert.strictEqual(chapters[2].end, 43770);
    });
  });

  describe('Download arguments', () => {
    const base = { url: 'https://www.twitch.tv/videos/2890199404', outDir: '/downloads/twitch-vods', duration: 43770 };

    test('treats a selection covering the whole VOD as a full download', () => {
      assert.strictEqual(resolveTwitchRange({ startTime: 0, endTime: 43770, duration: 43770 }).isSection, false);
      assert.strictEqual(resolveTwitchRange({ startTime: 0, endTime: 0, duration: 43770 }).isSection, false);
      assert.deepStrictEqual(
        resolveTwitchRange({ startTime: 5751.4, endTime: 5770.2, duration: 43770 }),
        { isSection: true, start: 5751, end: 5771, length: 20 }
      );
    });

    test('full VOD download uses the chosen resolution and parallel fragments', () => {
      const { args, range } = buildTwitchDownloadArgs({ ...base, formatId: '720p60', container: 'mkv', fragments: 16, startTime: 0, endTime: 43770 });
      assert.strictEqual(range.isSection, false);
      assert.strictEqual(args[args.indexOf('-f') + 1], '720p60/best');
      assert.strictEqual(args[args.indexOf('--remux-video') + 1], 'mkv');
      assert.strictEqual(args[args.indexOf('--concurrent-fragments') + 1], '16');
      assert.ok(!args.includes('--download-sections'));
      assert.ok(args.includes('--embed-metadata'));
      assert.ok(!args.includes('--no-embed-chapters'), 'full downloads keep chapter markers');
      assert.strictEqual(args[args.length - 1], base.url);
    });

    test('in/out points become a download section with a labelled filename', () => {
      const { args, range } = buildTwitchDownloadArgs({ ...base, formatId: '1080p60', startTime: 5751, endTime: 7931 });
      assert.strictEqual(range.isSection, true);
      assert.strictEqual(args[args.indexOf('--download-sections') + 1], '*5751-7931');
      assert.ok(!args.includes('--force-keyframes-at-cuts'));
      assert.ok(!args.includes('--concurrent-fragments'));
      assert.ok(args.includes('--no-embed-chapters'), 'trimmed clips must not carry full-VOD chapter timestamps');
      assert.match(args[args.indexOf('-o') + 1], /\(01h35m51s-02h12m11s\)\.%\(ext\)s$/);
    });

    test('frame-accurate cut adds keyframe forcing only for sections', () => {
      const section = buildTwitchDownloadArgs({ ...base, formatId: '480p', startTime: 10, endTime: 40, precise: true });
      assert.ok(section.args.includes('--force-keyframes-at-cuts'));
      const full = buildTwitchDownloadArgs({ ...base, formatId: '480p', precise: true });
      assert.ok(!full.args.includes('--force-keyframes-at-cuts'));
    });

    test('audio mode extracts the audio-only rendition', () => {
      const { args, isAudio } = buildTwitchDownloadArgs({ ...base, mode: 'audio', audioFormat: 'mp3', startTime: 60, endTime: 120 });
      assert.strictEqual(isAudio, true);
      assert.strictEqual(args[args.indexOf('-f') + 1], 'Audio_Only/bestaudio/best');
      assert.ok(args.includes('-x'));
      assert.strictEqual(args[args.indexOf('--audio-format') + 1], 'mp3');
      assert.ok(!args.includes('--remux-video'));
    });

    test('rejects unsafe or non-Twitch input', () => {
      assert.throws(() => buildTwitchDownloadArgs({ ...base, url: 'https://example.com/video' }), /Twitch/);
      assert.throws(() => buildTwitchDownloadArgs({ ...base, formatId: '720p --exec calc' }), /quality/i);
      assert.throws(() => buildTwitchDownloadArgs({ ...base, outDir: '' }), /output/i);
      const fallback = buildTwitchDownloadArgs({ ...base, container: 'exe', fragments: 9999 });
      assert.strictEqual(fallback.args[fallback.args.indexOf('--remux-video') + 1], 'mp4');
      assert.strictEqual(fallback.args[fallback.args.indexOf('--concurrent-fragments') + 1], '8');
    });
  });

  describe('Section progress translation', () => {
    test('parses FFmpeg stats lines', () => {
      const parsed = parseFfmpegProgressLine('frame=  538 fps=350 q=-1.0 size=    1280KiB time=00:00:18.89 bitrate= 554.9kbits/s speed=12.3x');
      assert.strictEqual(parsed.seconds, 18.89);
      assert.strictEqual(parsed.sizeBytes, 1280 * 1024);
      assert.strictEqual(parsed.speed, 12.3);
      assert.strictEqual(parseFfmpegProgressLine('frame=    0 fps=0.0 q=-1.0 size=       0KiB time=N/A bitrate=N/A speed=N/A'), null);
      assert.strictEqual(parseFfmpegProgressLine('[download] Destination: clip.mp4'), null);
    });

    test('emits yt-dlp style progress the shared renderer parser understands', () => {
      const line = formatSectionProgressLine({ seconds: 15, sizeBytes: 1048576, speed: 10 }, 30);
      // Same expression used by parseDownloadProgressOutput in renderer/download.js
      const rendererRegex = /\[download\]\s+([0-9.]+)%(?:\s+of\s+~?\s*([0-9.]+\s*[A-Za-z]+))?(?:\s+at\s+([0-9.]+\s*[A-Za-z/]+))?(?:\s+ETA\s+([0-9:]+))?/i;
      const match = line.match(rendererRegex);
      assert.ok(match, `renderer regex must match "${line}"`);
      assert.strictEqual(parseFloat(match[1]), 50);
      assert.strictEqual(match[2], '2.00MiB');
      assert.strictEqual(match[3], '10.0x');
      assert.strictEqual(match[4], '00:02');
      assert.ok(getRendererSource().includes(rendererRegex.source.slice(0, 40)), 'renderer progress regex changed — update this test');
    });

    test('never reports 100% before yt-dlp confirms completion', () => {
      const line = formatSectionProgressLine({ seconds: 31, sizeBytes: 0, speed: 0 }, 30);
      assert.match(line, /^\[download\]\s+99\.9%$/);
    });

    test('separates yt-dlp status lines from FFmpeg chatter', () => {
      assert.strictEqual(isYtDlpStatusLine('[download] Destination: C:\\clip.mp4'), true);
      assert.strictEqual(isYtDlpStatusLine('[twitch:vod] 123: Downloading m3u8 information'), true);
      assert.strictEqual(isYtDlpStatusLine('ERROR: [twitch:vod] 123: Video does not exist'), true);
      assert.strictEqual(isYtDlpStatusLine("[hls @ 0000027cc1600b00] Opening 'https://cdn/575.ts' for reading"), false);
      assert.strictEqual(isYtDlpStatusLine('Press [q] to stop, [?] for help'), false);
    });

    test('maps common Twitch failures to readable messages', () => {
      assert.match(describeTwitchError('ERROR: [twitch:vod] 1: This video is only available to subscribers'), /subscriber-only/i);
      assert.match(describeTwitchError('ERROR: [twitch:vod] 1: Video 1 does not exist'), /not found/i);
    });
  });

  describe('App wiring', () => {
    const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const preloadCode = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
    const mainCode = getMainSource();
    const rendererCode = getRendererSource();

    test('Twitch tab, controls and completion card exist in index.html', () => {
      const ids = [
        'twitch-tab', 'twitch-url', 'btn-twitch-load', 'twitch-video-player',
        'twitch-quality', 'twitch-container', 'twitch-fragments',
        'twitch-start-time-str', 'twitch-end-time-str', 'twitch-handle-start', 'twitch-handle-end',
        'twitch-chapters-list', 'twitch-precise-cut', 'twitch-embed-metadata',
        'btn-twitch-download', 'btn-twitch-download-audio',
        'twitch-download-complete-card', 'btn-twitch-open-folder', 'btn-twitch-open-file',
        'btn-twitch-copy-path', 'btn-twitch-dismiss-complete'
      ];
      for (const id of ids) {
        assert.ok(htmlContent.includes(`id="${id}"`), `index.html must define #${id}`);
      }
      assert.match(htmlContent, /class="nav-btn"\s+data-tab="twitch-tab"/);
    });

    test('completion card sits outside the workspace so it cannot be clipped', () => {
      const workspaceIdx = htmlContent.indexOf('id="twitch-workspace"');
      const cardIdx = htmlContent.indexOf('id="twitch-download-complete-card"');
      assert.ok(workspaceIdx !== -1 && cardIdx > workspaceIdx);
    });

    test('IPC channels are exposed, handled and loaded', () => {
      assert.ok(preloadCode.includes("ipcRenderer.invoke('fetch-twitch-info'"));
      assert.ok(preloadCode.includes("ipcRenderer.send('download-twitch-vod'"));
      assert.ok(mainCode.includes("ipcMain.handle('fetch-twitch-info'"));
      assert.ok(mainCode.includes("ipcMain.on('download-twitch-vod'"));
      assert.ok(mainCode.includes("require('./src/main/twitch')"), 'main.js must load the Twitch module');
      assert.ok(rendererCode.includes("import './twitch.js'"), 'renderer/index.js must import the Twitch tab');
    });

    test('shared download UI routes Twitch downloads to the Twitch tab and folder', () => {
      assert.ok(rendererCode.includes("type === 'twitch' || type === 'twitch-audio'"));
      assert.ok(mainCode.includes("twitch: 'twitch-vods'"));
    });
  });
});
