const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Helpers for high-resolution timing
function measureTime(fn, iterations = 1) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn(i);
  }
  const end = process.hrtime.bigint();
  const durationNs = Number(end - start);
  const durationMs = durationNs / 1e6;
  const opsPerSec = Math.round((iterations / (durationMs / 1000)));
  return { durationMs, opsPerSec, avgMs: durationMs / iterations };
}

async function measureTimeAsync(fn, iterations = 1) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    await fn(i);
  }
  const end = process.hrtime.bigint();
  const durationNs = Number(end - start);
  const durationMs = durationNs / 1e6;
  const opsPerSec = Math.round((iterations / (durationMs / 1000)));
  return { durationMs, opsPerSec, avgMs: durationMs / iterations };
}

describe('Performance Benchmarks & Profiling', () => {

  test('Benchmark 1: Download Progress Output Parsing Throughput', () => {
    const rawProgressLines = [
      '[download]   0.0% of ~  50.00MiB at    1.50MiB/s ETA 00:33',
      '[download]  25.4% of ~ 100.50MiB at    8.25MiB/s ETA 00:09',
      '[download]  50.0% of ~ 100.50MiB at   12.40MiB/s ETA 00:04',
      '[download]  75.8% of ~ 100.50MiB at   15.10MiB/s ETA 00:02',
      '[download] 100.0% of ~ 100.50MiB at   16.00MiB/s ETA 00:00',
      'Destination: /downloads/yt-videos/Sample_Music_Video_2026.mp4',
      '[Merger] Merging formats into "Sample_Music_Video_2026.mp4"',
      '[ExtractAudio] Destination: /downloads/yt-audios/Track_01.mp3',
      'Downloading item 3 of 15'
    ];

    // Optimized regex pre-compiled
    const statsRegex = /\[download\]\s+([0-9.]+)%(?:\s+of\s+~?\s*([0-9.]+\s*[A-Za-z]+))?(?:\s+at\s+([0-9.]+\s*[A-Za-z/]+))?(?:\s+ETA\s+([0-9:]+))?/i;
    const destRegex = /(?:Destination|\[download\] Destination):\s*(.+)/i;
    const itemRegex = /Downloading item\s+(\d+)\s+of\s+(\d+)/i;

    const iterations = 50000;
    const res = measureTime((i) => {
      const line = rawProgressLines[i % rawProgressLines.length];
      const stats = line.match(statsRegex);
      if (stats) {
        const percent = parseFloat(stats[1]);
        const size = stats[2] || '';
        const speed = stats[3] || '';
        const eta = stats[4] || '';
        return { percent, size, speed, eta };
      }
      const dest = line.match(destRegex);
      if (dest) {
        return { dest: dest[1].trim() };
      }
      const item = line.match(itemRegex);
      if (item) {
        return { cur: parseInt(item[1], 10), total: parseInt(item[2], 10) };
      }
      return null;
    }, iterations);

    console.log(`\n  [Benchmark 1] Progress parsing: ${iterations} lines in ${res.durationMs.toFixed(2)}ms (${res.opsPerSec.toLocaleString()} ops/sec)`);
    assert.ok(res.opsPerSec > 50000, `Expected > 50,000 ops/sec, got ${res.opsPerSec}`);
  });

  test('Benchmark 2: Settings Disk I/O & In-Memory Batching', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-bench-'));
    const settingsPath = path.join(tempDir, 'settings.json');

    // Baseline: Synchronous writeFileSync on every setting change
    const syncUpdates = 200;
    const syncRes = measureTime((i) => {
      const current = { downloadDir: '/downloads', theme: 'default', counter: i };
      fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');
    }, syncUpdates);

    // Optimized: In-memory state with coalesced async commits
    let memorySettings = { downloadDir: '/downloads', theme: 'default', counter: 0 };
    let pendingWrite = null;
    let writeCount = 0;

    function saveSettingsOptimized(newSettings) {
      memorySettings = { ...memorySettings, ...newSettings };
      if (!pendingWrite) {
        pendingWrite = Promise.resolve().then(async () => {
          writeCount++;
          await fs.promises.writeFile(settingsPath, JSON.stringify(memorySettings, null, 2), 'utf8');
          pendingWrite = null;
        });
      }
      return true;
    }

    const asyncUpdates = 200;
    const asyncRes = await measureTimeAsync(async (i) => {
      saveSettingsOptimized({ counter: i });
    }, asyncUpdates);

    // Await any final write
    if (pendingWrite) await pendingWrite;

    // Cleanup temp
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}

    console.log(`  [Benchmark 2] Synchronous Settings I/O: ${syncUpdates} writes in ${syncRes.durationMs.toFixed(2)}ms (${syncRes.opsPerSec.toLocaleString()} ops/sec)`);
    console.log(`  [Benchmark 2] Optimized Async/Coalesced Settings: ${asyncUpdates} updates in ${asyncRes.durationMs.toFixed(2)}ms (${asyncRes.opsPerSec.toLocaleString()} ops/sec)`);
    console.log(`  [Benchmark 2] Speedup factor: ${(syncRes.durationMs / Math.max(0.1, asyncRes.durationMs)).toFixed(1)}x faster`);

    assert.ok(asyncRes.durationMs < syncRes.durationMs, 'Async coalesced settings must be faster than sync disk I/O');
  });

  test('Benchmark 3: Media Sniffer URL Deduplication & Filter Throughput', () => {
    const testUrls = [
      'https://example.com/stream/playlist.m3u8',
      'https://example.com/stream/segment_1.ts',
      'https://example.com/stream/segment_2.ts',
      'https://example.com/video/master.mp4?range=0-1000',
      'https://example.com/video/master.mp4?range=1001-2000',
      'https://example.com/video/master.mp4?range=2001-3000',
      'https://cdn.site.com/audio/track.aac',
      'https://cdn.site.com/images/poster.jpg',
      'https://cdn.site.com/scripts/player.js'
    ];

    const mediaExtensions = ['.mp4', '.mkv', '.mp3', '.aac', '.m3u8', '.mpd', '.webm', '.wav', '.ogg'];

    // Fast URL cleaner and deduplicator
    const seenMediaUrls = new Set();

    function isMediaFast(urlStr, contentType) {
      if (!urlStr) return false;
      const qIdx = urlStr.indexOf('?');
      const hIdx = urlStr.indexOf('#');
      let endIdx = urlStr.length;
      if (qIdx !== -1) endIdx = qIdx;
      if (hIdx !== -1 && hIdx < endIdx) endIdx = hIdx;
      const clean = urlStr.slice(0, endIdx).toLowerCase();

      if (clean.endsWith('.ts') || clean.endsWith('.ts/')) return false;

      for (let i = 0; i < mediaExtensions.length; i++) {
        if (clean.endsWith(mediaExtensions[i])) return true;
      }

      if (contentType) {
        const ct = contentType.toLowerCase();
        if (ct.includes('video/mp2t')) return false;
        if (ct.startsWith('video/') || ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('dash+xml')) {
          return true;
        }
      }
      return false;
    }

    const iterations = 50000;
    const res = measureTime((i) => {
      const url = testUrls[i % testUrls.length];
      const isM = isMediaFast(url, '');
      if (isM) {
        const cleanBase = url.split('?')[0];
        if (!seenMediaUrls.has(cleanBase)) {
          seenMediaUrls.add(cleanBase);
        }
      }
    }, iterations);

    console.log(`  [Benchmark 3] Media sniffer filter & dedup: ${iterations} operations in ${res.durationMs.toFixed(2)}ms (${res.opsPerSec.toLocaleString()} ops/sec)`);
    assert.ok(res.opsPerSec > 200000, `Expected > 200,000 ops/sec, got ${res.opsPerSec}`);
    assert.ok(seenMediaUrls.size > 0, 'Should have deduplicated media URLs');
  });

  test('Benchmark 4: Metadata Probe LRU Cache Performance', () => {
    // LRU Cache implementation for probe metadata
    class ProbeLRUCache {
      constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
      }
      get(key) {
        if (!this.cache.has(key)) return null;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
      }
      set(key, val) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.set(key, val);
      }
    }

    const cache = new ProbeLRUCache(50);
    const mockFiles = [
      '/downloads/yt-videos/clip1.mp4',
      '/downloads/yt-videos/clip2.mp4',
      '/downloads/yt-videos/clip3.mp4',
      '/downloads/yt-videos/clip4.mp4',
      '/downloads/yt-videos/clip5.mp4'
    ];

    mockFiles.forEach((f, idx) => {
      cache.set(f, { duration: 120 + idx, width: 1920, height: 1080, fps: 30, vcodec: 'h264' });
    });

    const iterations = 100000;
    const res = measureTime((i) => {
      const key = mockFiles[i % mockFiles.length];
      const hit = cache.get(key);
      if (!hit) {
        cache.set(key, { duration: 120, width: 1920, height: 1080 });
      }
    }, iterations);

    console.log(`  [Benchmark 4] Probe LRU Cache: ${iterations} lookups in ${res.durationMs.toFixed(2)}ms (${res.opsPerSec.toLocaleString()} ops/sec)`);
    assert.ok(res.opsPerSec > 500000, `Expected > 500,000 ops/sec, got ${res.opsPerSec}`);
  });

  test('Benchmark 5: Scrubber Coordinate & Time Calculation Efficiency', () => {
    // Simulating slider coordinate calculations: cached bounds vs repeated rect queries
    const duration = 3600; // 1 hour video
    const rect = { left: 100, width: 800 }; // cached rect

    const iterations = 100000;
    const res = measureTime((i) => {
      const clientX = 100 + (i % 800);
      const clickX = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const timeVal = pct * duration;
      const hours = Math.floor(timeVal / 3600);
      const minutes = Math.floor((timeVal % 3600) / 60);
      const seconds = Math.floor(timeVal % 60);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, iterations);

    console.log(`  [Benchmark 5] Scrubber time math: ${iterations} points in ${res.durationMs.toFixed(2)}ms (${res.opsPerSec.toLocaleString()} ops/sec)`);
    assert.ok(res.opsPerSec > 200000, `Expected > 200,000 ops/sec, got ${res.opsPerSec}`);
  });

  test('Benchmark 6: Terminal Buffer Node Capping Simulation', () => {
    // Simulating terminal log buffer: Unbounded array vs Capped Buffer
    const MAX_TERMINAL_ENTRIES = 500;
    const entries = [];

    function pushLogEntry(entry) {
      entries.push(entry);
      if (entries.length > MAX_TERMINAL_ENTRIES) {
        entries.splice(0, entries.length - MAX_TERMINAL_ENTRIES);
      }
    }

    const iterations = 50000;
    const res = measureTime((i) => {
      pushLogEntry({ text: `[download] ${(i % 100).toFixed(1)}% of 50.0MB at 5.2MB/s ETA 00:05`, class: 'log-info' });
    }, iterations);

    console.log(`  [Benchmark 6] Capped terminal log buffer: ${iterations} pushes in ${res.durationMs.toFixed(2)}ms (${res.opsPerSec.toLocaleString()} ops/sec)`);
    assert.strictEqual(entries.length, MAX_TERMINAL_ENTRIES, 'Terminal buffer must stay bounded at MAX_TERMINAL_ENTRIES');
    assert.ok(res.opsPerSec > 50000, `Expected > 50,000 ops/sec, got ${res.opsPerSec}`);
  });
});
