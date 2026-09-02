// Recents Logic
export function getRecents() {
  const recents = localStorage.getItem('yt-recents');
  return recents ? JSON.parse(recents) : [];
}

export function saveRecent(url, type, filePath) {
  const recents = getRecents();
  recents.unshift({ url, type, filePath, date: new Date().toLocaleString() });
  if (recents.length > 20) recents.pop();
  localStorage.setItem('yt-recents', JSON.stringify(recents));
  renderRecents();
}

export function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export function bindRecentThumbnailActions(dragEl, filePath) {
  let nativeDragActive = false;
  let clickTimer = null;

  dragEl.setAttribute('draggable', 'true');
  dragEl.querySelectorAll('img, svg').forEach((child) => {
    child.setAttribute('draggable', 'false');
  });

  dragEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    nativeDragActive = false;
  });

  // Electron native drag-out: preventDefault in dragstart, then startDrag via IPC.
  // https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop
  // dragend does not fire after preventDefault, so click state cannot rely on it.
  dragEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    nativeDragActive = true;
    clearTimeout(clickTimer);
    window.electronAPI.startFileDrag(filePath);
  });

  dragEl.addEventListener('click', (e) => {
    if (nativeDragActive) {
      nativeDragActive = false;
      return;
    }
    if (e.detail > 1) {
      clearTimeout(clickTimer);
      return;
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      window.electronAPI.openFolder(filePath);
    }, 280);
  });

  dragEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    nativeDragActive = false;
    clearTimeout(clickTimer);
    if (window.electronAPI.openFile) {
      window.electronAPI.openFile(filePath);
    } else {
      window.electronAPI.openFolder(filePath);
    }
  });
}

export function renderRecents() {
  const list = document.getElementById('recents-list');
  list.innerHTML = '';
  const recents = getRecents();
  
  if (recents.length === 0) {
    list.innerHTML = '<li style="color: var(--muted-foreground); text-align: center; padding: 2rem;">No recent downloads.</li>';
    return;
  }
  
  recents.forEach(item => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    
    const videoId = extractVideoId(item.url);
    const isInstagram = item.url.includes('instagram.com') || item.url.includes('instagr.am') || item.type.startsWith('ig-');
    
    const thumbTitle = 'Click to reveal file · Double-click to open · Drag to import into Premiere Pro';
    let thumbnailHtml = '';
    if (videoId) {
      thumbnailHtml = `<img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail" class="recent-thumbnail" draggable="false">`;
    } else if (isInstagram) {
      thumbnailHtml = `<div class="recent-thumbnail">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
      </div>`;
    } else {
      thumbnailHtml = `<div class="recent-thumbnail"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
    }
    
    li.innerHTML = `
      <div class="recent-thumb-drag" title="${thumbTitle}">${thumbnailHtml}</div>
      <div class="recent-details">
        <button type="button" class="recent-url" title="${item.url}">${item.url}</button>
        <div class="recent-meta">
          <span class="badge">${item.type.toUpperCase()}</span>
          <span>${item.date}</span>
        </div>
      </div>
    `;

    const dragEl = li.querySelector('.recent-thumb-drag');
    if (dragEl && item.filePath) {
      bindRecentThumbnailActions(dragEl, item.filePath);
    }

    const urlEl = li.querySelector('.recent-url');
    if (urlEl) {
      urlEl.addEventListener('click', () => {
        window.electronAPI.openExternalUrl(item.url);
      });
    }

    list.appendChild(li);
  });
}

// Initial render

// Open Video / Audio save location buttons in Recents
const openVideoDirBtn = document.getElementById('btn-open-video-dir');
const openAudioDirBtn = document.getElementById('btn-open-audio-dir');

if (openVideoDirBtn) {
  openVideoDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('video');
  });
}

if (openAudioDirBtn) {
  openAudioDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('audio');
  });
}

const openInstagramDirBtn = document.getElementById('btn-open-instagram-dir');
if (openInstagramDirBtn) {
  openInstagramDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('instagram');
  });
}
