/**
 * Pure Twitch helpers — no Electron dependency.
 * Kept separate so unit tests can require them under plain Node.
 */

const TWITCH_SUBFOLDER = 'twitch-vods';
const FORMAT_ID_PATTERN = /^[A-Za-z0-9_.+-]{1,40}$/;
const ALLOWED_CONTAINERS = ['mp4', 'mkv'];
const ALLOWED_AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac', 'opus', 'aac'];
const ALLOWED_FRAGMENTS = [1, 2, 4, 8, 16];

// "1h35m51s", "95m", "42s" or plain seconds → seconds
function parseTwitchTimeParam(value) {
  if (!value) return 0;
  const str = String(value).trim().toLowerCase();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const match = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match || !match[0]) return 0;
  return (parseInt(match[1] || '0', 10) * 3600) +
    (parseInt(match[2] || '0', 10) * 60) +
    parseInt(match[3] || '0', 10);
}

/**
 * Classifies user input into a normalized Twitch URL.
 * kind: 'vod' | 'clip' | 'channel' | 'invalid'
 */
function classifyTwitchUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'invalid', url: '', startSeconds: 0 };

  // Bare VOD id (e.g. "2890199404" or "v2890199404")
  const bareId = raw.match(/^v?(\d{6,12})$/i);
  if (bareId) {
    return { kind: 'vod', url: `https://www.twitch.tv/videos/${bareId[1]}`, id: bareId[1], startSeconds: 0 };
  }

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { kind: 'invalid', url: '', startSeconds: 0 };
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'twitch.tv' && !host.endsWith('.twitch.tv')) {
    return { kind: 'invalid', url: '', startSeconds: 0 };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const startSeconds = parseTwitchTimeParam(parsed.searchParams.get('t'));

  if (host === 'clips.twitch.tv') {
    if (segments.length >= 1 && segments[0] !== 'embed') {
      return { kind: 'clip', url: `https://clips.twitch.tv/${segments[0]}`, id: segments[0], startSeconds: 0 };
    }
    const embedClip = parsed.searchParams.get('clip');
    if (embedClip) {
      return { kind: 'clip', url: `https://clips.twitch.tv/${embedClip}`, id: embedClip, startSeconds: 0 };
    }
    return { kind: 'invalid', url: '', startSeconds: 0 };
  }

  if (host === 'player.twitch.tv') {
    const video = (parsed.searchParams.get('video') || '').replace(/^v/i, '');
    if (/^\d+$/.test(video)) {
      return { kind: 'vod', url: `https://www.twitch.tv/videos/${video}`, id: video, startSeconds };
    }
    return { kind: 'invalid', url: '', startSeconds: 0 };
  }

  // twitch.tv/videos/<id>
  if (segments[0] === 'videos' && /^\d+$/.test(segments[1] || '')) {
    return { kind: 'vod', url: `https://www.twitch.tv/videos/${segments[1]}`, id: segments[1], startSeconds };
  }
  // twitch.tv/<channel>/v/<id> and twitch.tv/<channel>/video/<id>
  if ((segments[1] === 'v' || segments[1] === 'video') && /^\d+$/.test(segments[2] || '')) {
    return { kind: 'vod', url: `https://www.twitch.tv/videos/${segments[2]}`, id: segments[2], startSeconds };
  }
  // twitch.tv/<channel>/clip/<slug>
  if (segments[1] === 'clip' && segments[2]) {
    return { kind: 'clip', url: `https://clips.twitch.tv/${segments[2]}`, id: segments[2], startSeconds: 0 };
  }
  if (segments.length >= 1) {
    return { kind: 'channel', url: parsed.href, startSeconds: 0 };
  }
  return { kind: 'invalid', url: '', startSeconds: 0 };
}

function isVideoFormat(f) {
  if (!f || !f.format_id || !f.url) return false;
  if (f.ext === 'mhtml' || f.format_note === 'storyboard') return false;
  if (f.vcodec === 'none') return false;
  // Twitch clips often omit codec info — treat anything with a height as video
  return !!(f.height || (f.vcodec && f.vcodec !== 'none'));
}

function qualityLabel(f) {
  const height = Number(f.height) || 0;
  const fps = Math.round(Number(f.fps) || 0);
  if (!height) return String(f.format_id);
  return `${height}p${fps > 30 ? fps : ''}`;
}

/** Video qualities sorted best-first, with the Source rendition flagged. */
function buildTwitchQualities(parsed) {
  const formats = (parsed && Array.isArray(parsed.formats)) ? parsed.formats : [];
  const seen = new Set();
  const qualities = [];

  for (const f of formats) {
    if (!isVideoFormat(f) || seen.has(f.format_id)) continue;
    seen.add(f.format_id);
    qualities.push({
      id: String(f.format_id),
      label: qualityLabel(f),
      height: Number(f.height) || 0,
      width: Number(f.width) || 0,
      fps: Math.round(Number(f.fps) || 0),
      tbr: Number(f.tbr) || 0,
      isSource: /source/i.test(String(f.format_note || '')) || /^(chunked|source)$/i.test(String(f.format_id))
    });
  }

  qualities.sort((a, b) => (b.height - a.height) || (b.fps - a.fps) || (b.tbr - a.tbr));
  if (qualities.length > 0 && !qualities.some((q) => q.isSource)) {
    qualities[0].isSource = true;
  }
  return qualities;
}

function findTwitchAudioFormat(parsed) {
  const formats = (parsed && Array.isArray(parsed.formats)) ? parsed.formats : [];
  const audio = formats.find((f) => f && f.format_id && f.url && f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  return audio ? { id: String(audio.format_id), tbr: Number(audio.tbr) || 0 } : null;
}

/** Lightweight rendition for the in-app preview player (closest to 480p). */
function pickTwitchPreviewUrl(parsed) {
  const formats = (parsed && Array.isArray(parsed.formats)) ? parsed.formats : [];
  const candidates = formats.filter((f) => isVideoFormat(f) && String(f.url).startsWith('http'));
  if (candidates.length === 0) return (parsed && typeof parsed.url === 'string') ? parsed.url : '';

  const withAudio = candidates.filter((f) => f.acodec !== 'none');
  const pool = withAudio.length > 0 ? withAudio : candidates;
  const sorted = [...pool].sort((a, b) => {
    const da = Math.abs((Number(a.height) || 0) - 480);
    const db = Math.abs((Number(b.height) || 0) - 480);
    return (da - db) || ((Number(a.fps) || 0) - (Number(b.fps) || 0));
  });
  return sorted[0].url;
}

function normalizeTwitchChapters(parsed, duration) {
  const chapters = (parsed && Array.isArray(parsed.chapters)) ? parsed.chapters : [];
  return chapters
    .map((c) => ({
      title: String((c && c.title) || 'Untitled'),
      start: Math.max(0, Number(c && c.start_time) || 0),
      end: Math.max(0, Number(c && c.end_time) || 0)
    }))
    .map((c) => ({ ...c, end: duration > 0 ? Math.min(c.end, duration) : c.end }))
    .filter((c) => c.end > c.start);
}

function secondsToFileStamp(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(h)}h${pad(m)}m${pad(s)}s`;
}

/**
 * Resolves the requested in/out points into a download range.
 * A selection that covers the whole VOD is treated as a full download.
 */
function resolveTwitchRange({ startTime, endTime, duration }) {
  const total = Math.max(0, Number(duration) || 0);
  let start = Math.max(0, Math.floor(Number(startTime) || 0));
  let end = Number(endTime);
  if (!Number.isFinite(end) || end <= 0) end = total;
  end = Math.ceil(end);
  if (total > 0) {
    end = Math.min(end, Math.ceil(total));
    start = Math.min(start, Math.max(0, end - 1));
  }

  const coversEverything = start <= 0 && (total <= 0 || end >= Math.floor(total));
  if (coversEverything || end <= start) {
    return { isSection: false, start: 0, end: total, length: total };
  }
  return { isSection: true, start, end, length: end - start };
}

/**
 * Builds the yt-dlp argument list for a Twitch VOD / clip download.
 * Throws on invalid input so callers can surface a readable error.
 */
function buildTwitchDownloadArgs(options) {
  const {
    url,
    mode = 'video',
    formatId = '',
    container = 'mp4',
    audioFormat = 'mp3',
    startTime = 0,
    endTime = 0,
    duration = 0,
    precise = false,
    embedMetadata = true,
    fragments = 8,
    outDir,
    pathSep = '/',
    printToFile = ''
  } = options || {};

  const classified = classifyTwitchUrl(url);
  if (classified.kind !== 'vod' && classified.kind !== 'clip') {
    throw new Error('Not a Twitch VOD or clip URL.');
  }
  if (!outDir) throw new Error('Missing output directory.');

  const isAudio = mode === 'audio';
  const range = resolveTwitchRange({ startTime, endTime, duration });
  const args = ['--no-playlist'];
  let outputExt = '';

  if (isAudio) {
    const safeAudioFormat = ALLOWED_AUDIO_FORMATS.includes(audioFormat) ? audioFormat : 'mp3';
    outputExt = safeAudioFormat;
    args.push('-f', 'Audio_Only/bestaudio/best', '-x', '--audio-format', safeAudioFormat);
    if (safeAudioFormat === 'mp3') args.push('--audio-quality', '0');
  } else {
    if (formatId && !FORMAT_ID_PATTERN.test(formatId)) {
      throw new Error('Invalid quality selection.');
    }
    const safeContainer = ALLOWED_CONTAINERS.includes(container) ? container : 'mp4';
    outputExt = safeContainer;
    args.push('-f', formatId ? `${formatId}/best` : 'best');
    // Twitch renditions are single muxed H.264/AAC streams — remux only, never re-encode
    args.push('--remux-video', safeContainer);
  }

  if (range.isSection) {
    args.push('--download-sections', `*${range.start}-${range.end}`);
    if (precise) args.push('--force-keyframes-at-cuts');
  } else {
    const safeFragments = ALLOWED_FRAGMENTS.includes(Number(fragments)) ? Number(fragments) : 8;
    args.push('--concurrent-fragments', String(safeFragments));
  }

  if (embedMetadata) {
    args.push('--embed-metadata');
    // Chapter timestamps refer to the full VOD and would be wrong inside a trimmed section
    if (range.isSection) args.push('--no-embed-chapters');
  }

  const rangeSuffix = range.isSection
    ? ` (${secondsToFileStamp(range.start)}-${secondsToFileStamp(range.end)})`
    : '';
  const template = `%(uploader|Twitch)s - %(title).100B [%(id)s]${rangeSuffix}.%(ext)s`;
  args.push('-o', `${outDir}${pathSep}${template}`, '--no-mtime');

  if (printToFile) args.push('--print-to-file', 'after_move:filepath', printToFile);

  args.push(classified.url);
  return { args, range, isAudio, outputExt, url: classified.url };
}

function ffmpegClockToSeconds(clock) {
  const m = String(clock || '').match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (parseInt(m[1], 10) * 3600) + (parseInt(m[2], 10) * 60) + parseFloat(m[3]);
}

/** Parses an FFmpeg stats line ("frame= 238 ... size= 512KiB time=00:00:08.89 ... speed=8.69x"). */
function parseFfmpegProgressLine(line) {
  const text = String(line || '');
  const timeMatch = text.match(/\btime=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
  if (!timeMatch) return null;
  const seconds = ffmpegClockToSeconds(timeMatch[1]);
  if (!Number.isFinite(seconds)) return null;

  const sizeMatch = text.match(/\bL?size=\s*(\d+(?:\.\d+)?)\s*(KiB|kB|MiB|GiB|B)\b/i);
  const speedMatch = text.match(/\bspeed=\s*(\d+(?:\.\d+)?)x/);
  let sizeBytes = 0;
  if (sizeMatch) {
    const unit = sizeMatch[2].toLowerCase();
    const factor = unit === 'gib' ? 1073741824 : unit === 'mib' ? 1048576 : (unit === 'kib' || unit === 'kb') ? 1024 : 1;
    sizeBytes = parseFloat(sizeMatch[1]) * factor;
  }
  return { seconds, sizeBytes, speed: speedMatch ? parseFloat(speedMatch[1]) : 0 };
}

function formatBinarySize(bytes) {
  if (!(bytes > 0)) return '';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)}GiB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)}MiB`;
  return `${(bytes / 1024).toFixed(1)}KiB`;
}

function formatEtaClock(seconds) {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Section downloads run through FFmpeg, which reports elapsed media time instead
 * of a percentage. Convert that into a yt-dlp style "[download]  45.2% of ~ ..."
 * line so the shared renderer progress parser keeps working.
 */
function formatSectionProgressLine(progress, clipLength) {
  if (!progress || !(clipLength > 0)) return '';
  const ratio = Math.max(0, Math.min(1, progress.seconds / clipLength));
  const percent = Math.min(99.9, ratio * 100);
  let line = `[download] ${percent.toFixed(1).padStart(5)}%`;

  if (progress.sizeBytes > 0 && ratio > 0.02) {
    line += ` of ~ ${formatBinarySize(progress.sizeBytes / ratio)}`;
  }
  if (progress.speed > 0) {
    line += ` at ${progress.speed.toFixed(1)}x`;
    line += ` ETA ${formatEtaClock((clipLength - progress.seconds) / progress.speed)}`;
  }
  return line;
}

/** True for yt-dlp's own tagged output; false for raw FFmpeg chatter. */
function isYtDlpStatusLine(line) {
  return /^(\[[A-Za-z][A-Za-z0-9:_+-]*\]|ERROR|WARNING)/.test(String(line || '').trim());
}

function describeTwitchError(stderr) {
  const text = String(stderr || '');
  if (/subscriber-only|only available to subscribers|must be logged into an account that has access/i.test(text)) {
    return 'This VOD is subscriber-only. Sign in to Twitch in the Browser tab (or set browser cookies in Settings) with an account that has access, then try again.';
  }
  if (/does not exist|Video \d+ does not exist|404|not found/i.test(text)) {
    return 'This VOD was not found. It may have been deleted or expired (Twitch removes past broadcasts after 7–60 days).';
  }
  if (/Unsupported URL/i.test(text)) {
    return 'Unsupported Twitch URL. Paste a VOD link like https://www.twitch.tv/videos/123456789 or a clip link.';
  }
  if (/getaddrinfo|timed out|Unable to download|Connection (reset|refused)|network/i.test(text)) {
    return 'Network error while contacting Twitch. Check your connection and try again.';
  }
  const errorLine = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^ERROR/i.test(l)).pop();
  return (errorLine || text.trim().split(/\r?\n/).pop() || 'Failed to fetch Twitch VOD information.').slice(0, 400);
}

module.exports = {
  TWITCH_SUBFOLDER,
  parseTwitchTimeParam,
  classifyTwitchUrl,
  buildTwitchQualities,
  findTwitchAudioFormat,
  pickTwitchPreviewUrl,
  normalizeTwitchChapters,
  secondsToFileStamp,
  resolveTwitchRange,
  buildTwitchDownloadArgs,
  parseFfmpegProgressLine,
  formatSectionProgressLine,
  isYtDlpStatusLine,
  describeTwitchError
};
