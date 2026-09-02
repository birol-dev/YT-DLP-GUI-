const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// High-performance LRU Cache for memory-bounded caching
class SimpleLRUCache {
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
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
}

// Global LRU Caches to eliminate redundant child process spawns
const probeMetadataCache = new SimpleLRUCache(150);
const probePlaylistCache = new SimpleLRUCache(100);
const videoInfoCache = new SimpleLRUCache(100);
const inFlightProbes = new Map();
const detectedMediaUrlCache = new SimpleLRUCache(300);
const inFlightMediaProbes = new Set();

ctx.SimpleLRUCache = SimpleLRUCache;
ctx.probeMetadataCache = probeMetadataCache;
ctx.probePlaylistCache = probePlaylistCache;
ctx.videoInfoCache = videoInfoCache;
ctx.inFlightProbes = inFlightProbes;
ctx.detectedMediaUrlCache = detectedMediaUrlCache;
ctx.inFlightMediaProbes = inFlightMediaProbes;
module.exports = { SimpleLRUCache, probeMetadataCache, probePlaylistCache, videoInfoCache, inFlightProbes, detectedMediaUrlCache, inFlightMediaProbes };
