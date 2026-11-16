const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { Readable } = require('stream');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

let guestBrowserView = null;
let guestBrowserHooksVersion = 0;

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const GUEST_BROWSER_HOOKS_VERSION = 6;

// The in-app browser lives in its own persistent partition so that its catch-all webRequest hooks,
// UA override, permission handler and "clear data" never touch the app's own window (session.defaultSession).
const GUEST_BROWSER_PARTITION = 'persist:in-app-browser';
const GUEST_SESSION_MIGRATION_MARKER = 'in-app-browser-session-migrated.json';
let guestSessionReadyPromise = null;

function getGuestSession() {
  return session.fromPartition(GUEST_BROWSER_PARTITION);
}

// One-time copy of the cookies the in-app browser used to keep in session.defaultSession.
async function migrateDefaultSessionCookiesToGuest() {
  let markerPath;
  try {
    markerPath = path.join(app.getPath('userData'), GUEST_SESSION_MIGRATION_MARKER);
    if (fs.existsSync(markerPath)) return;
  } catch (e) {
    return;
  }

  let cookies;
  try {
    cookies = await session.defaultSession.cookies.get({});
  } catch (e) {
    return; // try again next launch
  }

  const guestCookies = getGuestSession().cookies;
  let copied = 0;
  for (const cookie of cookies) {
    try {
      const host = (cookie.domain || '').replace(/^\./, '');
      if (!host || !cookie.name) continue;
      const cookiePath = cookie.path || '/';
      const details = {
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookiePath}`,
        name: cookie.name,
        value: cookie.value || '',
        path: cookiePath,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly)
      };
      if (!cookie.hostOnly) details.domain = cookie.domain;
      if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      if (cookie.sameSite) details.sameSite = cookie.sameSite;
      await guestCookies.set(details);
      copied++;
      // The copy succeeded, so drop the original: nothing in the app window needs it, and leaving it behind
      // would keep old logins in a session that "Clear browser data" can no longer reach.
      try {
        await session.defaultSession.cookies.remove(details.url, cookie.name);
      } catch (e) {}
    } catch (e) {
      // ignore individual cookie failures
    }
  }

  try {
    fs.writeFileSync(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), copied }), 'utf8');
  } catch (e) {}
}

// Resolves once the guest session is safe to use. Never rejects.
function ensureGuestSessionReady() {
  if (!guestSessionReadyPromise) {
    guestSessionReadyPromise = migrateDefaultSessionCookiesToGuest().catch((err) => {
      console.error('In-app browser cookie migration failed:', err && err.message);
    });
  }
  return guestSessionReadyPromise;
}

function getGuestPageUrl() {
  if (guestBrowserView && !guestBrowserView.webContents.isDestroyed()) {
    const url = guestBrowserView.webContents.getURL();
    if (url && url.startsWith('http')) return url;
  }
  return '';
}

function buildStreamRequestHeaders(pageUrl) {
  const referer = pageUrl || getGuestPageUrl();
  const headers = [`User-Agent: ${BROWSER_USER_AGENT}`];
  if (referer) {
    try {
      headers.push(`Referer: ${new URL(referer).origin}/`);
    } catch (e) {
      headers.push(`Referer: ${referer}`);
    }
  }
  return headers;
}

function resolveGuestRequestOrigin(details) {
  const pageUrl = getGuestPageUrl();
  if (pageUrl) {
    try {
      return new URL(pageUrl).origin;
    } catch (e) {}
  }
  if (details.referrer && details.referrer.startsWith('http')) {
    try {
      return new URL(details.referrer).origin;
    } catch (e) {}
  }
  return '*';
}

const EMBED_PLAYER_HOST_HINTS = [
  'vidrame.pro', 'vidrame.net', 'vidplay', 'vidmoly', 'moly.to',
  'close.video', 'rapidvid', 'streamtape', 'dood', 'filemoon',
  'embed', 'player.', 'cdn.'
];

const EMBED_PROXY_HOSTS = [
  'vidrame.pro', 'vidrame.net', 'vidmoly.to', 'vidplay',
  'close.video', 'rapidvid', 'streamtape.com', 'doodstream', 'filemoon'
];

function isEmbedPlayerHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return EMBED_PLAYER_HOST_HINTS.some((hint) => host === hint || host.endsWith('.' + hint) || host.includes(hint));
}

function isEmbedProxyHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return EMBED_PROXY_HOSTS.some((hint) => host === hint || host.endsWith('.' + hint));
}

function getHeaderIgnoreCase(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function deleteHeaderIgnoreCase(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

function isNavigationResourceType(resourceType) {
  return resourceType === 'mainFrame' || resourceType === 'subFrame';
}

function refererMatchesParentSite(referer, parentHostname) {
  if (!referer || !referer.startsWith('http')) return false;
  try {
    const refHost = new URL(referer).hostname;
    const parent = parentHostname.replace(/^www\./, '');
    const refBase = refHost.replace(/^www\./, '');
    return refHost === parentHostname || refBase === parent || refHost.endsWith('.' + parent);
  } catch (e) {
    return false;
  }
}

function applyGuestBrowserHeaders(details, requestHeaders) {
  const topUrl = getGuestPageUrl();
  if (!topUrl) return requestHeaders;

  let parsedPage;
  let parsedReq;
  try {
    parsedPage = new URL(topUrl);
    parsedReq = new URL(details.url);
  } catch (e) {
    return requestHeaders;
  }

  const existingReferer = getHeaderIgnoreCase(requestHeaders, 'referer') || '';
  const refererOk = existingReferer && existingReferer.startsWith('http');
  const isCrossOrigin = parsedReq.hostname !== parsedPage.hostname;
  const isNavigation = isNavigationResourceType(details.resourceType);

  if (isNavigation) {
    deleteHeaderIgnoreCase(requestHeaders, 'Origin');
  }

  if (isEmbedProxyHost(parsedReq.hostname)) {
    requestHeaders['Referer'] = topUrl;
  } else if (!refererOk) {
    requestHeaders['Referer'] = topUrl;
  }

  const rt = details.resourceType;
  if (rt === 'subFrame' && isCrossOrigin) {
    requestHeaders['Sec-Fetch-Site'] = 'cross-site';
    requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    requestHeaders['Sec-Fetch-Dest'] = 'iframe';
    requestHeaders['Sec-Fetch-User'] = '?1';
  } else if (rt === 'mainFrame') {
    requestHeaders['Sec-Fetch-Site'] = 'none';
    requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    requestHeaders['Sec-Fetch-Dest'] = 'document';
    requestHeaders['Sec-Fetch-User'] = '?1';
  } else if (isCrossOrigin && (rt === 'media' || rt === 'xhr')) {
    requestHeaders['Sec-Fetch-Site'] = 'cross-site';
    requestHeaders['Sec-Fetch-Mode'] = rt === 'media' ? 'no-cors' : 'cors';
    requestHeaders['Sec-Fetch-Dest'] = rt === 'media' ? 'video' : 'empty';
  }

  if (!isNavigation && isCrossOrigin && !getHeaderIgnoreCase(requestHeaders, 'origin')) {
    requestHeaders['Origin'] = parsedPage.origin;
  }

  requestHeaders['User-Agent'] = BROWSER_USER_AGENT;
  requestHeaders['sec-ch-ua'] = '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"';
  requestHeaders['sec-ch-ua-mobile'] = '?0';
  requestHeaders['sec-ch-ua-platform'] = '"Windows"';
  if (!getHeaderIgnoreCase(requestHeaders, 'accept-language')) {
    requestHeaders['Accept-Language'] = 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7';
  }

  return requestHeaders;
}

function buildEmbedReferer(topUrl) {
  if (!topUrl) return '';
  try {
    return new URL(topUrl).origin + '/';
  } catch (e) {
    return topUrl;
  }
}

function injectEmbedBaseHref(html, targetUrl) {
  try {
    const baseHref = new URL(targetUrl).origin + '/';
    if (!/<base\s/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
    }
  } catch (e) {}
  return html;
}

function buildBrowserProxyUrl(targetUrl, referer) {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  if (referer) params.set('referer', referer);
  return `browser-proxy://fetch?${params.toString()}`;
}

function getEmbedProxyUrlFilters() {
  return ['*://*/*'];
}

function registerGuestEmbedProxy(session) {
  // Do not redirect subFrame navigations to browser-proxy:// — Chromium blocks custom
  // schemes in cross-origin iframes (net::ERR_BLOCKED_BY_CLIENT). Referer injection
  // for embed hosts is handled via CDP Fetch in setupGuestNetworkHooks.
  void session;
}

async function fetchEmbedDocument(targetUrl, referer) {
  const target = normalizeEmbedUrl(targetUrl);
  const refererCandidates = [];
  if (referer) {
    refererCandidates.push(referer, buildEmbedReferer(referer));
  }
  refererCandidates.push('');

  for (const ref of refererCandidates) {
    const headers = {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    if (ref) headers['Referer'] = ref;

    try {
      const response = await getGuestSession().fetch(target, { headers });
      if (!response.ok) continue;
      const html = await response.text();
      if (!html || html.length < 80) continue;
      return injectEmbedBaseHref(html, target);
    } catch (e) {
      continue;
    }
  }
  return null;
}

function getEmbedFetchPatterns() {
  const patterns = [];
  for (const hint of EMBED_PROXY_HOSTS) {
    if (hint.includes('.')) {
      patterns.push({ urlPattern: `*://${hint}/*`, requestStage: 'Request' });
      patterns.push({ urlPattern: `*://*.${hint}/*`, requestStage: 'Request' });
    } else {
      patterns.push({ urlPattern: `*://*${hint}*/*`, requestStage: 'Request' });
    }
  }
  return patterns;
}

function normalizeEmbedUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('vidrame') && !parsed.searchParams.has('ap')) {
      parsed.searchParams.set('ap', '1');
      return parsed.toString();
    }
    return targetUrl;
  } catch (e) {
    return targetUrl;
  }
}

const hydratedIframeUrls = new Set();
const embedIframeFirstSeen = new Map();
const EMBED_SRCDOC_WAIT_MS = 3000;

function startEmbedIframeHydration(webContents) {
  const scan = async () => {
    if (!webContents || webContents.isDestroyed()) return;
    const pageUrl = webContents.getURL();
    if (!pageUrl.startsWith('http')) return;

    let targets = [];
    try {
      targets = await webContents.executeJavaScript(`(() => {
        const embedHints = ['vidrame', 'vidmoly', 'vidplay', 'close.video', 'rapidvid', 'streamtape', 'dood', 'filemoon'];
        const results = [];
        document.querySelectorAll('iframe').forEach((ifr, index) => {
          if (ifr.dataset.ytEmbedHydrated === '1') return;
          const dataSrc = (ifr.getAttribute('data-src') || '').trim();
          const src = (ifr.getAttribute('src') || '').trim();
          const raw = dataSrc || src;
          if (!raw || raw.startsWith('about:') || raw.startsWith('browser-proxy:')) return;
          let absolute = raw;
          try { absolute = new URL(raw, location.href).href; } catch (e) { return; }
          const host = (() => { try { return new URL(absolute).hostname; } catch (e) { return ''; } })();
          if (!embedHints.some((hint) => host.includes(hint))) return;
          const immediate = Boolean(dataSrc && (!src || src.startsWith('about:')));
          results.push({ index, url: absolute, immediate });
        });
        return results;
      })`);
    } catch (e) {
      return;
    }

    const now = Date.now();
    for (const target of targets) {
      const waitKey = `${target.index}:${target.url}`;
      if (!target.immediate) {
        if (!embedIframeFirstSeen.has(waitKey)) {
          embedIframeFirstSeen.set(waitKey, now);
        }
        if (now - embedIframeFirstSeen.get(waitKey) < EMBED_SRCDOC_WAIT_MS) {
          continue;
        }
      }

      if (hydratedIframeUrls.has(target.url)) continue;

      const html = await fetchEmbedDocument(target.url, pageUrl);
      if (!html) continue;

      const htmlJson = JSON.stringify(html);
      try {
        await webContents.executeJavaScript(`(() => {
          const ifr = document.querySelectorAll('iframe')[${target.index}];
          if (!ifr || ifr.dataset.ytEmbedHydrated === '1') return;
          ifr.removeAttribute('src');
          ifr.removeAttribute('data-src');
          ifr.removeAttribute('sandbox');
          ifr.srcdoc = ${htmlJson};
          ifr.dataset.ytEmbedHydrated = '1';
        })`);
        hydratedIframeUrls.add(target.url);
      } catch (e) {}
    }
  };

  const resetHydration = () => {
    hydratedIframeUrls.clear();
    embedIframeFirstSeen.clear();
  };

  let scanTimer = null;
  let remainingScans = 0;

  const triggerScanCycle = (count = 5) => {
    remainingScans = count;
    if (!scanTimer) {
      scan();
      scanTimer = setInterval(() => {
        remainingScans--;
        if (remainingScans <= 0 || !webContents || webContents.isDestroyed()) {
          clearInterval(scanTimer);
          scanTimer = null;
          return;
        }
        scan();
      }, 800);
    }
  };

  webContents.on('did-finish-load', () => {
    resetHydration();
    triggerScanCycle(6);
  });
  webContents.on('did-navigate', resetHydration);
  webContents.on('did-navigate-in-page', () => {
    resetHydration();
    triggerScanCycle(5);
  });

  webContents.once('destroyed', () => {
    if (scanTimer) clearInterval(scanTimer);
  });
  triggerScanCycle(5);
}

function setupGuestNetworkHooks(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const dbg = webContents.debugger;
  let networkEnabled = false;
  let fetchEnabled = false;

  const onFetchPaused = async (event, method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const { requestId, request } = params;
    const referer = getGuestPageUrl();
    if (!referer) {
      try { await dbg.sendCommand('Fetch.continueRequest', { requestId }); } catch (e) {}
      return;
    }
    try {
      const headers = Object.entries({ ...request.headers, Referer: referer })
        .map(([name, value]) => ({ name, value: String(value) }));
      await dbg.sendCommand('Fetch.continueRequest', { requestId, headers });
    } catch (e) {
      try { await dbg.sendCommand('Fetch.continueRequest', { requestId }); } catch (e2) {}
    }
  };

  dbg.on('message', onFetchPaused);

  const syncReferer = async () => {
    const referer = getGuestPageUrl();
    if (!referer) return;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (!networkEnabled) {
        await dbg.sendCommand('Network.enable');
        networkEnabled = true;
      }
      if (!fetchEnabled) {
        await dbg.sendCommand('Fetch.enable', { patterns: getEmbedFetchPatterns() });
        fetchEnabled = true;
      }
      await dbg.sendCommand('Network.setExtraHTTPHeaders', {
        headers: {
          Referer: referer,
          'User-Agent': BROWSER_USER_AGENT
        }
      });
    } catch (e) {
      console.error('Guest network referer sync failed:', e.message);
    }
  };

  webContents.on('did-start-navigation', syncReferer);
  webContents.on('did-navigate-in-page', syncReferer);
  webContents.on('did-finish-load', syncReferer);
  webContents.once('destroyed', () => dbg.removeListener('message', onFetchPaused));
  syncReferer();
}

const MEDIA_EXTENSIONS = ['.mp4', '.mkv', '.mp3', '.aac', '.m3u8', '.mpd', '.webm', '.wav', '.ogg'];
const MEDIA_MIME_TYPES = ['video/', 'audio/', 'application/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/dash+xml'];

function isMedia(urlStr, contentType) {
  if (!urlStr) return false;
  
  const qIdx = urlStr.indexOf('?');
  const hIdx = urlStr.indexOf('#');
  let endIdx = urlStr.length;
  if (qIdx !== -1) endIdx = qIdx;
  if (hIdx !== -1 && hIdx < endIdx) endIdx = hIdx;
  const cleanUrl = urlStr.slice(0, endIdx).toLowerCase();

  if (cleanUrl.endsWith('.ts') || cleanUrl.endsWith('.ts/')) {
    return false;
  }
  
  for (let i = 0; i < MEDIA_EXTENSIONS.length; i++) {
    if (cleanUrl.endsWith(MEDIA_EXTENSIONS[i])) return true;
  }
  
  if (contentType) {
    const cType = contentType.toLowerCase();
    if (cType.includes('video/mp2t')) {
      return false;
    }
    for (let i = 0; i < MEDIA_MIME_TYPES.length; i++) {
      if (cType.includes(MEDIA_MIME_TYPES[i])) return true;
    }
  }
  
  return false;
}

ipcMain.on('browser-view-init', async (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await ensureGuestSessionReady();
  if (!win || win.isDestroyed()) return;

  if (guestBrowserView && guestBrowserHooksVersion < GUEST_BROWSER_HOOKS_VERSION) {
    try {
      win.contentView.removeChildView(guestBrowserView);
      guestBrowserView.webContents.close();
    } catch (e) {}
    guestBrowserView = null;
  }

  if (!guestBrowserView) {
    guestBrowserView = new WebContentsView({
      webPreferences: {
        partition: GUEST_BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    
    guestBrowserView.webContents.setUserAgent(BROWSER_USER_AGENT);
    const guestSession = getGuestSession();
    guestSession.setUserAgent(BROWSER_USER_AGENT);
    
    win.contentView.addChildView(guestBrowserView);
    
    // Set permission request handler for media and fullscreen support
    guestSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'geolocation', 'notifications', 'fullscreen', 'pointerLock'];
      callback(allowed.includes(permission));
    });
    
    // Handle target="_blank" and window.open links by navigating in the same view
    guestBrowserView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        guestBrowserView.webContents.loadURL(url);
      }
      return { action: 'deny' };
    });
    
    guestBrowserView.webContents.loadURL('https://www.google.com');
    
    const sendNav = (url) => {
      // The renderer clears its visible sniffer list on every navigation; reset the dedupe cache with it
      // so media that was already seen is reported again after navigating away and back.
      ctx.detectedMediaUrlCache.clear();
      if (!win.isDestroyed()) {
        win.webContents.send('browser-navigate', url);
      }
    };
    guestBrowserView.webContents.on('did-navigate', (e, url) => sendNav(url));
    guestBrowserView.webContents.on('did-navigate-in-page', (e, url) => sendNav(url));
    
    registerGuestEmbedProxy(guestSession);
    setupGuestNetworkHooks(guestBrowserView.webContents);
    startEmbedIframeHydration(guestBrowserView.webContents);
    
    guestSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const incomingHeaders = { ...details.requestHeaders };
      if (getHeaderIgnoreCase(incomingHeaders, INTERNAL_FETCH_HEADER) !== undefined) {
        // media-preview:// fetch: send exactly what the protocol handler built, minus the marker
        deleteHeaderIgnoreCase(incomingHeaders, INTERNAL_FETCH_HEADER);
        if (internalRequestIds.size >= 500) internalRequestIds.delete(internalRequestIds.values().next().value);
        internalRequestIds.add(details.id);
        callback({ requestHeaders: incomingHeaders });
        return;
      }
      const requestHeaders = applyGuestBrowserHeaders(details, incomingHeaders);
      callback({ requestHeaders });
    });

    guestSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      if (internalRequestIds.has(details.id)) {
        callback({ cancel: false });
        return;
      }
      const responseHeaders = { ...details.responseHeaders };
      
      // Remove blocking headers to allow embeds and standard playback
      const headersToRemove = [
        'x-frame-options',
        'content-security-policy',
        'cross-origin-resource-policy',
        'cross-origin-embedder-policy',
        'cross-origin-opener-policy'
      ];
      for (const key of Object.keys(responseHeaders)) {
        if (headersToRemove.includes(key.toLowerCase())) {
          delete responseHeaders[key];
        }
      }

      // Let cross-origin embed iframes send a full Referer (Chromium default strips it).
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        responseHeaders['Referrer-Policy'] = ['unsafe-url'];
      }

      // Determine requesting origin for CORS dynamically to avoid credentials/wildcard conflicts
      const requestOrigin = resolveGuestRequestOrigin(details);

      responseHeaders['Access-Control-Allow-Origin'] = [requestOrigin];
      responseHeaders['Access-Control-Allow-Headers'] = ['Range, Content-Range, Content-Length, Accept, Origin, Referer, Content-Type, Authorization'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
      if (requestOrigin !== '*') {
        responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
      }
      responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];

      // Inspect content-type for sniffer
      let contentType = '';
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'content-type') {
          contentType = responseHeaders[key][0];
          break;
        }
      }

      const url = details.url;
      if (isMedia(url, contentType)) {
        const cleanBaseUrl = url.split('?')[0];
        if (!ctx.detectedMediaUrlCache.has(cleanBaseUrl)) {
          ctx.detectedMediaUrlCache.set(cleanBaseUrl, true);
          if (!win.isDestroyed()) {
            // Send immediately to UI
            const pageUrl = getGuestPageUrl();
            win.webContents.send('media-detected', {
              url: url,
              title: guestBrowserView.webContents.getTitle() || 'Media Stream',
              contentType: contentType,
              pageUrl: pageUrl
            });

            if (!ctx.inFlightMediaProbes.has(cleanBaseUrl)) {
              ctx.inFlightMediaProbes.add(cleanBaseUrl);
              const headers = buildStreamRequestHeaders(pageUrl);

              ctx.probeLocalVideo(url, headers).then(meta => {
                ctx.inFlightMediaProbes.delete(cleanBaseUrl);
                if (!win.isDestroyed()) {
                  win.webContents.send('media-probed', {
                    url: url,
                    width: meta.width || 0,
                    height: meta.height || 0,
                    duration: meta.duration || 0,
                    vcodec: meta.vcodec || 'Unknown',
                    fps: meta.fps || 0
                  });
                }
              }).catch(err => {
                ctx.inFlightMediaProbes.delete(cleanBaseUrl);
                console.log('Background stream probe failed:', err.message);
              });
            }
          }
        }
      }
      callback({ cancel: false, responseHeaders: responseHeaders });
    });

    guestBrowserHooksVersion = GUEST_BROWSER_HOOKS_VERSION;
  }

  guestBrowserView.setBounds(bounds);
});

ipcMain.on('browser-view-load', (event, url) => {
  if (guestBrowserView) {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    guestBrowserView.webContents.loadURL(targetUrl).catch(err => {
      console.error('Failed to load url:', err);
    });
  }
});

ipcMain.handle('browser-clear-data', async () => {
  // Only the in-app browser's own partition is wiped; the app window's storage (defaultSession) is untouched.
  try {
    const ses = getGuestSession();
    await ses.clearStorageData();
    await ses.clearCache();
    ctx.detectedMediaUrlCache.clear();
    return true;
  } catch (err) {
    console.error('Failed to clear browser storage/cache data:', err);
    return false;
  }
});

ipcMain.on('browser-view-control', (event, action) => {
  if (guestBrowserView) {
    if (action === 'back' && guestBrowserView.webContents.canGoBack()) {
      guestBrowserView.webContents.goBack();
    } else if (action === 'forward' && guestBrowserView.webContents.canGoForward()) {
      guestBrowserView.webContents.goForward();
    } else if (action === 'reload') {
      guestBrowserView.webContents.reload();
    }
  }
  // Sent by the renderer's sniffer "Clear" button: forget what was already reported.
  if (action === 'clear-detected-media') {
    ctx.detectedMediaUrlCache.clear();
  }
});

ipcMain.on('browser-view-resize', (event, bounds) => {
  if (guestBrowserView) {
    guestBrowserView.setBounds(bounds);
  }
});

ipcMain.on('browser-view-hide', () => {
  if (guestBrowserView) {
    guestBrowserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
});

const STREAM_VIDEO_COPY_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];
// Audio codec (as reported by ffprobe) -> container that can hold it with a plain stream copy.
const STREAM_AUDIO_COPY_CONTAINERS = {
  aac: '.m4a',
  mp3: '.mp3',
  opus: '.opus',
  vorbis: '.ogg',
  flac: '.flac'
};

// Picks the output container and codec args for a sniffed stream. Manifests (.m3u8 / .mpd) and unknown
// extensions must never be used as the output extension (a .mpd output makes ffmpeg write a DASH manifest
// plus chunk files instead of one media file).
function pickStreamOutput(url, isAudioOnly, acodec) {
  if (isAudioOnly) {
    const container = STREAM_AUDIO_COPY_CONTAINERS[String(acodec || '').toLowerCase()];
    if (container) {
      return { ext: container, codecArgs: ['-vn', '-c:a', 'copy'] };
    }
    // Unknown / incompatible audio codec: transcode so the result is always a valid, playable .mp3
    return { ext: '.mp3', codecArgs: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'] };
  }

  let urlExt = '';
  try {
    urlExt = path.extname(String(url || '').split('?')[0].split('#')[0]).toLowerCase();
  } catch (e) {}
  const ext = STREAM_VIDEO_COPY_EXTENSIONS.includes(urlExt) ? urlExt : '.mp4';
  return { ext, codecArgs: ['-c', 'copy'] };
}

ipcMain.on('download-media-stream', async (event, { url, title, contentType, pageUrl }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');

  const isAudioOnly = contentType && contentType.toLowerCase().startsWith('audio/');
  const subFolder = isAudioOnly ? 'yt-audios' : 'yt-videos';
  const targetDir = path.join(baseDir, subFolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let cleanTitle = ctx.sanitizeFilename(title || 'stream_download');

  if (win && !win.isDestroyed()) win.webContents.send('download-status', `[STREAM] Starting direct FFmpeg download...`);

  const ffmpegPath = ctx.getFfmpegPath();

  const headers = buildStreamRequestHeaders(pageUrl);

  let totalDuration = 0;
  let acodec = '';
  try {
    const meta = await ctx.probeLocalVideo(url, headers);
    totalDuration = meta.duration || 0;
    acodec = meta.acodec || '';
  } catch (err) {
    console.log('Stream probe failed (normal for live/some hosts):', err.message);
  }

  const { ext, codecArgs } = pickStreamOutput(url, isAudioOnly, acodec);

  let baseOut = path.join(targetDir, cleanTitle);
  let count = 0;
  let outputPath = `${baseOut}${ext}`;
  while (fs.existsSync(outputPath)) {
    count++;
    outputPath = `${baseOut}_${count}${ext}`;
  }

  const args = [
    '-y',
    '-headers', headers.join('\r\n') + '\r\n',
    '-i', url,
    ...codecArgs,
    outputPath
  ];

  let proc;
  try {
    proc = spawn(ffmpegPath, args);
    ctx.registerProcess(proc, { isYtDlp: false, group: 'download' });
  } catch (err) {
    if (win && !win.isDestroyed()) win.webContents.send('download-error', `[STREAM] FFmpeg failed to start: ${err.message}`);
    return;
  }

  let stderr = '';

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;

    if (totalDuration > 0) {
      const progress = ctx.parseFfmpegProgress(text, totalDuration);
      if (progress !== null) {
        if (win && !win.isDestroyed()) win.webContents.send('download-progress', `[download]  ${Math.round(progress)}% of stream`);
      }
    } else {
      const match = text.match(/time=\s*(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        if (win && !win.isDestroyed()) win.webContents.send('download-progress', `[download]  Copied ${match[1]}:${match[2]}:${match[3]} of media`);
      }
    }
  });

  proc.on('close', (code) => {
    if (!win || win.isDestroyed()) return;
    if (code === 0) {
      win.webContents.send('download-complete', {
        type: isAudioOnly ? 'stream-audio' : 'stream-video',
        url: url,
        status: 'Success',
        filePath: outputPath
      });
      if (ctx.settings.autoOpenFolder) {
        ctx.openFolderOrRevealItem(outputPath);
      }
    } else if (code === null || ctx.wasProcessStopped(proc)) {
      // Killed (user cancelled / channel switch) - the registry already notified the renderer
    } else {
      win.webContents.send('download-error', `[STREAM] FFmpeg ${isAudioOnly ? 'audio extraction' : 'copy'} failed with code ${code}.\nStderr: ${stderr.slice(-200)}`);
    }
  });

  proc.on('error', (err) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('download-error', `[STREAM] FFmpeg failed to start: ${err.message}`);
    }
  });
});

const PREVIEW_CORS_EXPOSE_HEADERS = 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Upstream-Url';

function buildPreviewCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': PREVIEW_CORS_EXPOSE_HEADERS,
    'Access-Control-Max-Age': '600'
  };
}

const PREVIEW_MAX_REDIRECTS = 8;

// Marks requests made by the media-preview handler so the guest session's sniffer / header hooks leave them alone
// (otherwise the app's own preview fetches would show up as "detected media").
const INTERNAL_FETCH_HEADER = 'X-YTGUI-Internal';
const internalRequestIds = new Set();

// Requests the media through the guest session (its cookies), following redirects by hand so the final URL is
// known: net.fetch / Session.fetch have no `session` option / no usable response.url, and hls.js needs the final
// URL to resolve relative playlist entries.
function requestRemotePreview(targetUrl, method, headers) {
  return new Promise((resolve, reject) => {
    let finalUrl = targetUrl;
    let hops = 0;
    const req = net.request({
      method,
      url: targetUrl,
      session: getGuestSession(),
      useSessionCookies: true,
      redirect: 'manual'
    });
    for (const [name, value] of Object.entries({ ...headers, [INTERNAL_FETCH_HEADER]: '1' })) {
      req.setHeader(name, value);
    }
    req.on('redirect', (statusCode, redirectMethod, redirectUrl) => {
      if (++hops > PREVIEW_MAX_REDIRECTS || !/^https?:\/\//i.test(redirectUrl)) {
        req.abort();
        reject(new Error('Too many redirects or unsupported redirect target'));
        return;
      }
      finalUrl = redirectUrl;
      req.followRedirect();
    });
    req.on('response', (res) => resolve({ res, finalUrl }));
    req.on('error', reject);
    req.end();
  });
}

function getFirstHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// Re-wraps an upstream response for media-preview://, keeping the range semantics intact
// (206 + Content-Range / Accept-Ranges) so seeking works, and exposing the final upstream URL
// so hls.js can resolve relative playlist entries against the real origin.
function buildPreviewResponse(res, method, finalUrl) {
  const headers = new Headers(buildPreviewCorsHeaders());
  const encoded = Boolean(getFirstHeader(res.headers, 'content-encoding'));
  for (const name of ['content-type', 'content-range', 'accept-ranges', 'content-length']) {
    // the body is already decoded, so an encoded Content-Length would be wrong
    if (name === 'content-length' && encoded) continue;
    const value = getFirstHeader(res.headers, name);
    if (value) headers.set(name, value);
  }
  if (finalUrl) headers.set('X-Upstream-Url', finalUrl);
  const bodyless = method === 'HEAD' || [204, 205, 304].includes(res.statusCode);
  if (bodyless) res.resume();
  return new Response(bodyless ? null : Readable.toWeb(res), {
    status: res.statusCode,
    statusText: res.statusMessage,
    headers
  });
}

function registerMediaProtocols() {
  protocol.handle('media-preview', async (request) => {
    try {
      // The app window (file://) loads previews cross-origin (hls.js XHR), so CORS preflights land here too.
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: buildPreviewCorsHeaders() });
      }

      const parsed = new URL(request.url);
      const targetUrl = parsed.searchParams.get('url');
      const pageUrl = parsed.searchParams.get('pageUrl') || getGuestPageUrl();
      if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400, headers: buildPreviewCorsHeaders() });
      }

      // Local Clipper sources and remuxed previews (allowed roots only): serve the file directly (with Range).
      // Do not attach the guest session / Referer — that breaks large file:// playback.
      if (targetUrl.startsWith('file:')) {
        let filePath;
        try {
          filePath = path.normalize(fileURLToPath(targetUrl));
        } catch {
          return new Response('Invalid file URL', { status: 400 });
        }
        const allowedRoots = [
          path.normalize(app.getPath('userData')),
          path.normalize(ctx.settings.downloadDir || app.getPath('downloads')),
          path.normalize(app.getPath('temp'))
        ];
        const allowed = allowedRoots.some((root) => filePath === root || filePath.startsWith(root + path.sep));
        if (!allowed) {
          return new Response('Forbidden local path', { status: 403 });
        }
        return net.fetch(targetUrl, { method: request.method, headers: request.headers });
      }

      if (!/^https?:\/\//i.test(targetUrl)) {
        return new Response('Unsupported url scheme', { status: 400, headers: buildPreviewCorsHeaders() });
      }

      // Remote media is fetched through the in-app browser session (cookies) with the page as Referer.
      const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
      const fetchHeaders = { 'User-Agent': BROWSER_USER_AGENT };
      if (pageUrl) fetchHeaders['Referer'] = pageUrl;
      const range = request.headers.get('range');
      if (range) fetchHeaders['Range'] = range;

      const { res, finalUrl } = await requestRemotePreview(targetUrl, method, fetchHeaders);
      return buildPreviewResponse(res, method, finalUrl);
    } catch (err) {
      return new Response(err.message, { status: 500, headers: buildPreviewCorsHeaders() });
    }
  });

  protocol.handle('browser-proxy', async (request) => {
    try {
      const parsed = new URL(request.url);
      const targetUrl = parsed.searchParams.get('url');
      const referer = parsed.searchParams.get('referer') || getGuestPageUrl() || '';
      if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
      }
      const fetchUrl = normalizeEmbedUrl(targetUrl);

      const refererCandidates = [];
      if (referer) {
        refererCandidates.push(referer);
        const originReferer = buildEmbedReferer(referer);
        if (originReferer && originReferer !== referer) {
          refererCandidates.push(originReferer);
        }
      }
      if (refererCandidates.length === 0) {
        refererCandidates.push('');
      }

      let lastResponse = null;
      for (const ref of refererCandidates) {
        const fetchHeaders = {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': '*/*',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"'
        };
        if (ref) fetchHeaders['Referer'] = ref;

        const response = await getGuestSession().fetch(fetchUrl, { headers: fetchHeaders });
        if (response.status === 404 && ref !== refererCandidates[refererCandidates.length - 1]) {
          lastResponse = response;
          continue;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) {
          const html = await response.text();
          const body = injectEmbedBaseHref(html, fetchUrl);
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Referrer-Policy': 'unsafe-url'
            }
          });
        }

        if (response.status !== 404) {
          return response;
        }
        lastResponse = response;
      }

      return lastResponse || new Response('Upstream not found', { status: 404 });
    } catch (err) {
      console.error('browser-proxy fetch failed:', err.message);
      return new Response(err.message, { status: 502 });
    }
  });
}


Object.defineProperty(ctx, 'guestBrowserView', {
  get() { return guestBrowserView; },
  set(v) { guestBrowserView = v; },
  enumerable: true,
  configurable: true
});
Object.defineProperty(ctx, 'guestBrowserHooksVersion', {
  get() { return guestBrowserHooksVersion; },
  set(v) { guestBrowserHooksVersion = v; },
  enumerable: true,
  configurable: true
});
ctx.BROWSER_USER_AGENT = BROWSER_USER_AGENT;
ctx.GUEST_BROWSER_HOOKS_VERSION = GUEST_BROWSER_HOOKS_VERSION;
ctx.GUEST_BROWSER_PARTITION = GUEST_BROWSER_PARTITION;
ctx.getGuestSession = getGuestSession;
ctx.ensureGuestSessionReady = ensureGuestSessionReady;
ctx.migrateDefaultSessionCookiesToGuest = migrateDefaultSessionCookiesToGuest;
ctx.pickStreamOutput = pickStreamOutput;
ctx.getGuestPageUrl = getGuestPageUrl;
ctx.buildStreamRequestHeaders = buildStreamRequestHeaders;
ctx.resolveGuestRequestOrigin = resolveGuestRequestOrigin;
ctx.EMBED_PLAYER_HOST_HINTS = EMBED_PLAYER_HOST_HINTS;
ctx.EMBED_PROXY_HOSTS = EMBED_PROXY_HOSTS;
ctx.isEmbedPlayerHost = isEmbedPlayerHost;
ctx.isEmbedProxyHost = isEmbedProxyHost;
ctx.getHeaderIgnoreCase = getHeaderIgnoreCase;
ctx.deleteHeaderIgnoreCase = deleteHeaderIgnoreCase;
ctx.isNavigationResourceType = isNavigationResourceType;
ctx.refererMatchesParentSite = refererMatchesParentSite;
ctx.applyGuestBrowserHeaders = applyGuestBrowserHeaders;
ctx.buildEmbedReferer = buildEmbedReferer;
ctx.injectEmbedBaseHref = injectEmbedBaseHref;
ctx.buildBrowserProxyUrl = buildBrowserProxyUrl;
ctx.getEmbedProxyUrlFilters = getEmbedProxyUrlFilters;
ctx.registerGuestEmbedProxy = registerGuestEmbedProxy;
ctx.fetchEmbedDocument = fetchEmbedDocument;
ctx.getEmbedFetchPatterns = getEmbedFetchPatterns;
ctx.normalizeEmbedUrl = normalizeEmbedUrl;
ctx.hydratedIframeUrls = hydratedIframeUrls;
ctx.embedIframeFirstSeen = embedIframeFirstSeen;
ctx.EMBED_SRCDOC_WAIT_MS = EMBED_SRCDOC_WAIT_MS;
ctx.startEmbedIframeHydration = startEmbedIframeHydration;
ctx.setupGuestNetworkHooks = setupGuestNetworkHooks;
ctx.MEDIA_EXTENSIONS = MEDIA_EXTENSIONS;
ctx.MEDIA_MIME_TYPES = MEDIA_MIME_TYPES;
ctx.isMedia = isMedia;
ctx.registerMediaProtocols = registerMediaProtocols;
module.exports = { guestBrowserView, guestBrowserHooksVersion, BROWSER_USER_AGENT, GUEST_BROWSER_HOOKS_VERSION, GUEST_BROWSER_PARTITION, getGuestSession, ensureGuestSessionReady, migrateDefaultSessionCookiesToGuest, pickStreamOutput, getGuestPageUrl, buildStreamRequestHeaders, resolveGuestRequestOrigin, EMBED_PLAYER_HOST_HINTS, EMBED_PROXY_HOSTS, isEmbedPlayerHost, isEmbedProxyHost, getHeaderIgnoreCase, deleteHeaderIgnoreCase, isNavigationResourceType, refererMatchesParentSite, applyGuestBrowserHeaders, buildEmbedReferer, injectEmbedBaseHref, buildBrowserProxyUrl, getEmbedProxyUrlFilters, registerGuestEmbedProxy, fetchEmbedDocument, getEmbedFetchPatterns, normalizeEmbedUrl, hydratedIframeUrls, embedIframeFirstSeen, EMBED_SRCDOC_WAIT_MS, startEmbedIframeHydration, setupGuestNetworkHooks, MEDIA_EXTENSIONS, MEDIA_MIME_TYPES, isMedia, registerMediaProtocols };
