/**
 * Pure stream-URL helpers for the clipper — no Electron dependency.
 * Kept separate so unit tests can require them under plain Node.
 */

function extractStreamUrls(parsed) {
  let streamUrl = '';
  let audioUrl = '';

  if (!parsed) return { streamUrl, audioUrl };

  // 1. Direct url on parsed object (if combined)
  if (parsed.url && parsed.vcodec && parsed.vcodec !== 'none' && parsed.acodec && parsed.acodec !== 'none') {
    return { streamUrl: parsed.url, audioUrl: '' };
  }

  const formats = (parsed.formats || []).filter(f => f && f.url && f.url.startsWith('http') && f.protocol !== 'm3u8_native');

  // 2. Combined video + audio formats (e.g. non-YT sites or legacy YT format 18)
  const combined = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
  if (combined.length > 0) {
    const preferredCombined = combined.find(f => f.format_id === '18') ||
      combined.find(f => f.ext === 'mp4' && f.height <= 720 && f.height >= 360) ||
      combined.find(f => f.ext === 'mp4') ||
      combined[0];
    return { streamUrl: preferredCombined.url, audioUrl: '' };
  }

  // 3. Separate video and audio streams (modern YouTube DASH streams)
  const videoOnly = formats.filter(f => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'));
  if (videoOnly.length > 0) {
    // Prefer 360p or 480p or 720p H.264/avc1 mp4 for smooth, fast preview scrubbing in Chromium
    const preferredVideo =
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height === 360) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height === 480) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height <= 720 && f.height >= 360) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1')) ||
      videoOnly.find(f => f.ext === 'mp4' && f.height <= 720) ||
      videoOnly.find(f => f.ext === 'mp4') ||
      videoOnly.find(f => typeof f.vcodec === 'string' && (f.vcodec.startsWith('vp9') || f.vcodec.startsWith('vp09'))) ||
      videoOnly[0];

    if (preferredVideo) {
      streamUrl = preferredVideo.url;
    }
  }

  const audioOnly = formats.filter(f => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none');
  if (audioOnly.length > 0) {
    // Prefer m4a (AAC) which plays natively in Chromium with minimal overhead
    const preferredAudio =
      audioOnly.find(f => f.ext === 'm4a' && typeof f.acodec === 'string' && f.acodec.startsWith('mp4a')) ||
      audioOnly.find(f => f.ext === 'm4a') ||
      audioOnly.find(f => typeof f.acodec === 'string' && f.acodec.startsWith('mp4a')) ||
      audioOnly.find(f => f.ext === 'webm') ||
      audioOnly[0];

    if (preferredAudio) {
      audioUrl = preferredAudio.url;
    }
  }

  if (!streamUrl && parsed.url) {
    streamUrl = parsed.url;
  }

  return { streamUrl, audioUrl };
}

module.exports = { extractStreamUrls };
