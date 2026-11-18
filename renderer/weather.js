import { getWeatherIconSVG } from '../assets/weather-icons.js';
import { state } from './state.js';
import { pickGreeting } from './greetings.js';
import { escapeHtml } from './html.js';

// App Dashboard Initializer
export async function initAppDashboard() {
  await refreshGreeting();

  // Render weather & clock
  initWeatherAndClock();
}

// Re-render the greeting with the current display name (settings name, else system username)
export async function refreshGreeting() {
  let sysUsername = '';
  try {
    const sysInfo = await window.electronAPI.getSystemInfo();
    sysUsername = (sysInfo && sysInfo.username) || '';
  } catch (err) {
    console.error('Failed to read system info for greeting:', err);
  }
  renderGreeting(state.currentSettings.userName || sysUsername || 'user');
}

// Drop every cached weather payload (used when city, coordinates or unit change)
export function clearWeatherCache() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('weather_')) localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('Failed to clear weather cache:', err);
  }
}

// Open-Meteo geocoding: "City, Region, Country" label for a search result.
export function formatCityDisplayName(city) {
  const region = city.admin1 ? `, ${city.admin1}` : '';
  const country = city.country ? `, ${city.country}` : '';
  return `${city.name}${region}${country}`;
}

// Resolve a typed place name to its top match. Returns { name, lat, lon } or null
// (no match, bad response or network failure).
export async function geocodeCity(query) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return null;
  // The search matches place names only, so a "City, Region, Country" label (what the autocomplete
  // and the IP lookup produce) is retried with just the part before the first comma.
  const candidates = [trimmed];
  const firstPart = trimmed.split(',')[0].trim();
  if (firstPart.length >= 2 && firstPart !== trimmed) candidates.push(firstPart);
  try {
    for (const name of candidates) {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
      if (!res.ok) continue;
      const data = await res.json();
      const top = data && Array.isArray(data.results) ? data.results[0] : null;
      if (top && Number.isFinite(top.latitude) && Number.isFinite(top.longitude)) {
        return { name: formatCityDisplayName(top), lat: top.latitude, lon: top.longitude };
      }
    }
    return null;
  } catch (err) {
    console.error('Geocoding lookup failed:', err);
    return null;
  }
}

// Render Time-of-day greetings
export function renderGreeting(name) {
  const { title, subtitle } = pickGreeting(name);
  
  const titleEls = document.querySelectorAll('.greeting-title');
  const subtitleEls = document.querySelectorAll('.greeting-subtitle');
  titleEls.forEach(el => {
    el.textContent = title;
  });
  subtitleEls.forEach(el => {
    el.textContent = subtitle;
  });
}

// Weather Widget and Clock timers
let weatherTimer = null;
let clockTimer = null;

export function initWeatherAndClock() {
  if (weatherTimer) clearInterval(weatherTimer);
  if (clockTimer) clearInterval(clockTimer);
  
  updateWeather();
  updateClock();
  
  weatherTimer = setInterval(updateWeather, 15 * 60 * 1000); // 15 mins
  clockTimer = setInterval(updateClock, 1000); // 1 sec
}

export function updateClock() {
  const timeEls = document.querySelectorAll('.weather-time-value');
  const timeStr = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  timeEls.forEach(el => {
    el.textContent = timeStr;
  });
}

function renderWeatherError(widgets, title, hint) {
  widgets.forEach(w => {
    w.innerHTML = `
      <div class="weather-loading" style="flex-direction: column; gap: 4px; padding: 0.25rem 0.5rem; text-align: center;">
        <span style="color: #ef4444; font-weight: 500;">${escapeHtml(title)}</span>
        <span style="font-size: 0.7rem; opacity: 0.8; color: hsl(var(--muted-foreground));">${escapeHtml(hint)}</span>
      </div>
    `;
  });
}

// Only the newest updateWeather() call may render, so a slow older request can't overwrite it.
let weatherRequestId = 0;

export async function updateWeather() {
  const widgets = document.querySelectorAll('.weather-widget');
  if (widgets.length === 0) return;

  const requestId = ++weatherRequestId;
  const isStale = () => requestId !== weatherRequestId;

  let lat = state.currentSettings.weatherLat;
  let lon = state.currentSettings.weatherLon;
  const savedCity = state.currentSettings.weatherCity || '';
  let city = savedCity || 'Estimated Location';
  const tempFormat = state.currentSettings.tempFormat || 'fahrenheit';
  const unitSymbol = tempFormat === 'fahrenheit' ? '°F' : '°C';

  if ((!lat || !lon) && savedCity) {
    // A city name without coordinates: resolve the name itself. Never pair the
    // name with an IP-derived location, or the label would disagree with the data.
    const resolved = await geocodeCity(savedCity);
    if (isStale()) return;
    if (!resolved) {
      renderWeatherError(widgets, 'Location not found', 'Check the city in Settings');
      return;
    }
    lat = resolved.lat;
    lon = resolved.lon;
  } else if (!lat || !lon) {
    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      const ipData = await ipRes.json();
      if (ipData.latitude && ipData.longitude) {
        lat = ipData.latitude;
        lon = ipData.longitude;
        if (ipData.city) {
          const region = ipData.region ? `, ${ipData.region}` : '';
          city = `${ipData.city}${region}`;
        }
      }
    } catch (err) {
      console.error('IP Geolocation failed in updateWeather:', err);
    }
    if (isStale()) return;
  }

  if (!lat || !lon) {
    const noLocationHTML = `
      <div class="weather-icon-container" title="No location configured">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-weather-station" width="24" height="24">
          <path d="M12 2v20" />
          <path d="m17 22-5-5-5 5" />
          <rect x="9" y="10" width="6" height="5" rx="1" />
          <path d="M10 12h4M10 14h4" />
          <path d="M8 4h8" />
          <circle cx="8" cy="4" r="1.5" fill="currentColor" />
          <circle cx="16" cy="4" r="1.5" fill="currentColor" />
          <path d="m12 4-2-2m2 2 2-2" />
          <path d="M18 8c1.5-1.5 1.5-4 0-5.5" />
          <path d="M6 8c-1.5-1.5-1.5-4 0-5.5" />
        </svg>
      </div>
      <div class="weather-info">
        <div class="weather-temp-row">
          <span style="font-size: 0.85rem; font-weight: 600; color: hsl(var(--muted-foreground));">Setup Weather</span>
        </div>
        <div class="weather-desc" style="font-size: 0.7rem; margin-top: 2px;">No location set</div>
        <div class="weather-location-row" style="font-size: 0.7rem;">
          <span>Click to configure</span>
        </div>
      </div>
    `;
    widgets.forEach(w => {
      w.innerHTML = noLocationHTML;
    });
    return;
  }
  
  const cacheKey = `weather_${lat}_${lon}_${tempFormat}`;
  const cached = getCachedWeather(cacheKey);
  if (cached) {
    widgets.forEach((w, idx) => {
      renderWeatherCardContent(w, cached, city, unitSymbol, idx);
    });
    return;
  }
  
  // Try Open-Meteo first
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${tempFormat}&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    
    if (data.current_weather && Number.isFinite(Number(data.current_weather.temperature))) {
      if (isStale()) return;
      saveCachedWeather(cacheKey, data.current_weather);
      widgets.forEach((w, idx) => {
        renderWeatherCardContent(w, data.current_weather, city, unitSymbol, idx);
      });
      return;
    }
  } catch (err) {
    console.warn('Open-Meteo failed, trying wttr.in fallback...', err);
  }
  
  // Fallback to wttr.in
  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wttr.in error ${res.status}`);
    const data = await res.json();

    const cond = data && Array.isArray(data.current_condition) ? data.current_condition[0] : null;
    if (!cond) throw new Error('wttr.in returned no current_condition data');

    const temp = tempFormat === 'fahrenheit' ? parseFloat(cond.temp_F) : parseFloat(cond.temp_C);
    if (!Number.isFinite(temp)) throw new Error('wttr.in returned no usable temperature');
    const wwoCode = parseInt(cond.weatherCode, 10);
    const weathercode = wwoCodeToWmo(wwoCode);

    const weatherData = {
      temperature: temp,
      weathercode: weathercode
    };

    if (isStale()) return;
    saveCachedWeather(cacheKey, weatherData);
    widgets.forEach((w, idx) => {
      renderWeatherCardContent(w, weatherData, city, unitSymbol, idx);
    });
  } catch (err) {
    console.error('All weather services failed:', err);
    if (isStale()) return;
    renderWeatherError(widgets, 'Failed to fetch weather', 'Click to retry');
  }
}

export function wwoCodeToWmo(wwoCode) {
  if (wwoCode === 113) return 0; // Clear
  if (wwoCode === 116) return 2; // Partly Cloudy
  if ([119, 122].includes(wwoCode)) return 3; // Cloudy/Overcast
  if ([143, 248, 260].includes(wwoCode)) return 45; // Fog
  if ([263, 266, 293, 296, 299, 302, 305, 308].includes(wwoCode)) return 63; // Rain
  if ([227, 230, 323, 326, 329, 332, 335, 338, 350, 368, 371, 395].includes(wwoCode)) return 73; // Snow
  if ([386, 389, 392].includes(wwoCode)) return 95; // Thunderstorm
  return 3;
}

export function renderWeatherCardContent(widget, weatherData, city, unitSymbol, index) {
  const temp = Math.round(Number(weatherData.temperature));
  const desc = escapeHtml(getWeatherDescription(weatherData.weathercode));
  const iconSvg = getWeatherIconSVG(weatherData.weathercode, index);
  city = escapeHtml(city);
  unitSymbol = escapeHtml(unitSymbol);
  
  widget.innerHTML = `
    <div class="weather-icon-container" title="${desc}">
      ${iconSvg}
    </div>
    <div class="weather-info">
      <div class="weather-temp-row">
        <span class="weather-temp">${temp}${unitSymbol}</span>
      </div>
      <div class="weather-desc">${desc}</div>
      <div class="weather-location-row" title="${city}">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${city}</span>
      </div>
      <div class="weather-time-row">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="weather-time-value">${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    </div>
  `;
}

// Weather Cache helpers
export function getCachedWeather(key) {
  cleanExpiredWeatherCaches();
  const cacheStr = localStorage.getItem(key);
  if (!cacheStr) return null;
  try {
    const cache = JSON.parse(cacheStr);
    if (Date.now() - cache.timestamp > 30 * 60 * 1000) { // 30 mins
      localStorage.removeItem(key);
      return null;
    }
    return cache.data;
  } catch (e) {
    localStorage.removeItem(key);
    return null;
  }
}

export function saveCachedWeather(key, data) {
  const cache = {
    timestamp: Date.now(),
    data: data
  };
  localStorage.setItem(key, JSON.stringify(cache));
}

export function cleanExpiredWeatherCaches() {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('weather_')) {
      try {
        const cache = JSON.parse(localStorage.getItem(key));
        if (Date.now() - cache.timestamp > 2 * 60 * 60 * 1000) {
          localStorage.removeItem(key);
        }
      } catch (e) {
        localStorage.removeItem(key);
      }
    }
  }
}

export function getWeatherDescription(weatherCode) {
  const mapping = {
    0: "Clear Sky",
    1: "Mainly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing Rime Fog",
    51: "Light Drizzle",
    53: "Moderate Drizzle",
    55: "Dense Drizzle",
    56: "Light Freezing Drizzle",
    57: "Dense Freezing Drizzle",
    61: "Slight Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    66: "Light Freezing Rain",
    67: "Heavy Freezing Rain",
    71: "Slight Snowfall",
    73: "Moderate Snowfall",
    75: "Heavy Snowfall",
    77: "Snow Grains",
    80: "Slight Rain Showers",
    81: "Moderate Rain Showers",
    82: "Violent Rain Showers",
    85: "Slight Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "Thunderstorm with Hail",
    99: "Thunderstorm with Heavy Hail"
  };
  return mapping[weatherCode] || "Cloudy";
}

// Click weather card to auto-update or switch to settings
document.querySelectorAll('.weather-widget').forEach(widget => {
  widget.addEventListener('click', () => {
    const lat = state.currentSettings.weatherLat;
    const lon = state.currentSettings.weatherLon;
    
    if ((!lat || !lon) && !state.currentSettings.weatherCity) {
      // If no location is set, switch to settings tab so they can configure it
      const settingsBtn = document.querySelector('[data-tab="settings-tab"]');
      if (settingsBtn) {
        settingsBtn.click();
      }
      return;
    }
    
    // Clear cache
    if (lat && lon) {
      const tempFormat = state.currentSettings.tempFormat || 'fahrenheit';
      localStorage.removeItem(`weather_${lat}_${lon}_${tempFormat}`);
    }
    
    // Show loading spinner on all widgets
    document.querySelectorAll('.weather-widget').forEach(w => {
      w.innerHTML = `
        <div class="weather-loading">
          <div class="loading-spinner small"></div>
          <span>Refreshing weather...</span>
        </div>
      `;
    });
    
    // Refresh weather
    updateWeather();
  });
});
