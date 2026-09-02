export function secondsToHHMMSS(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

export function hhmmssToSeconds(str) {
  const parts = str.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  } else if (parts.length === 1) {
    seconds += parseFloat(parts[0]);
  }
  return isNaN(seconds) ? 0 : seconds;
}

export function secondsToHHMMSSWithMs(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00.000';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const hmsStr = [h, m % 60, s % 60].map(v => v.toString().padStart(2, '0')).join(':');
  const msStr = ms.toString().padStart(3, '0');
  return `${hmsStr}.${msStr}`;
}

export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '--';
  if (bytes < 1024) return bytes + ' Bytes';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

export function hhmmssToSecondsWithMs(str) {
  if (!str) return 0;
  const mainParts = str.split('.');
  const timeStr = mainParts[0];
  const msStr = mainParts[1] || '0';
  
  const parts = timeStr.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseInt(parts[2], 10);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseInt(parts[1], 10);
  } else if (parts.length === 1) {
    seconds += parseInt(parts[0], 10);
  }
  
  const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10) / 1000;
  return seconds + ms;
}

/** Shared slider math used by clipper, divider, and gif timelines. */
export function sliderPercents(startVal, endVal, duration) {
  if (!(duration > 0)) return { startPct: 0, endPct: 0, widthPct: 0 };
  const startPct = (startVal / duration) * 100;
  const endPct = (endVal / duration) * 100;
  const widthPct = Math.max(0, endPct - startPct);
  return { startPct, endPct, widthPct };
}

export function pointerToTime(clientX, rect, duration) {
  const clickX = clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / (rect.width || 1)));
  return { pct, timeVal: pct * duration };
}
