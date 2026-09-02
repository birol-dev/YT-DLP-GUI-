import { getWeatherIconSVG } from '../assets/weather-icons.js';
import { state } from './state.js';

// App Dashboard Initializer
export async function initAppDashboard() {
  const sysInfo = await window.electronAPI.getSystemInfo();
  const displayName = state.currentSettings.userName || sysInfo.username || 'user';
  
  // Render greeting
  renderGreeting(displayName);
  
  // Render weather & clock
  initWeatherAndClock();
}

// Render Time-of-day greetings
export function renderGreeting(name) {
  const now = new Date();
  const hour = now.getHours();
  
  let titlePool = [];
  let subtitlePool = [];
  
  if (hour >= 5 && hour < 12) {
    titlePool = [
      'Good morning, {name}!',
      'Rise and shine, {name}!',
      'Wishing you a great morning, {name}!'
    ];
    subtitlePool = [
      'What are we downloading today?',
      'Ready to save some awesome videos?',
      'Let\'s start the day with some downloads!'
    ];
  } else if (hour >= 12 && hour < 17) {
    titlePool = [
      'Good afternoon, {name}!',
      'Welcome back, {name}!',
      'Hope your afternoon is going great, {name}!'
    ];
    subtitlePool = [
      'Ready to grab more videos?',
      'What\'s on your download list today?',
      'Let\'s download something interesting!'
    ];
  } else if (hour >= 17 && hour < 22) {
    titlePool = [
      'Good evening, {name}!',
      'Evening, {name}!',
      'Welcome back, {name}!'
    ];
    subtitlePool = [
      'Winding down with some downloads?',
      'Let\'s get your offline queue ready!',
      'What are we working on tonight?'
    ];
  } else {
    titlePool = [
      'Good night, {name}!',
      'Hello night owl, {name}!',
      'Rest well, {name}!'
    ];
    subtitlePool = [
      'Working late tonight?',
      'Grab your late-night downloads here.',
      'Need some offline content for the night?'
    ];
  }
  
  const randTitle = titlePool[Math.floor(Math.random() * titlePool.length)].replace('{name}', name);
  const randSubtitle = subtitlePool[Math.floor(Math.random() * subtitlePool.length)];
  
  const titleEls = document.querySelectorAll('.greeting-title');
  const subtitleEls = document.querySelectorAll('.greeting-subtitle');
  titleEls.forEach(el => {
    el.textContent = randTitle;
  });
  subtitleEls.forEach(el => {
    el.textContent = randSubtitle;
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

export async function updateWeather() {
  const widgets = document.querySelectorAll('.weather-widget');
  if (widgets.length === 0) return;
  
  let lat = state.currentSettings.weatherLat;
  let lon = state.currentSettings.weatherLon;
  let city = state.currentSettings.weatherCity || 'Estimated Location';
  const tempFormat = state.currentSettings.tempFormat || 'fahrenheit';
  const unitSymbol = tempFormat === 'fahrenheit' ? '°F' : '°C';
  
  if (!lat || !lon) {
    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      const ipData = await ipRes.json();
      if (ipData.latitude && ipData.longitude) {
        lat = ipData.latitude;
        lon = ipData.longitude;
        if (!state.currentSettings.weatherCity) {
          const region = ipData.region ? `, ${ipData.region}` : '';
          city = `${ipData.city}${region}`;
        }
      }
    } catch (err) {
      console.error('IP Geolocation failed in updateWeather:', err);
    }
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
    
    if (data.current_weather) {
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
    
    if (data.current_condition && data.current_condition.length > 0) {
      const cond = data.current_condition[0];
      const temp = tempFormat === 'fahrenheit' ? parseFloat(cond.temp_F) : parseFloat(cond.temp_C);
      const wwoCode = parseInt(cond.weatherCode);
      const weathercode = wwoCodeToWmo(wwoCode);
      
      const weatherData = {
        temperature: temp,
        weathercode: weathercode
      };
      
      saveCachedWeather(cacheKey, weatherData);
      widgets.forEach((w, idx) => {
        renderWeatherCardContent(w, weatherData, city, unitSymbol, idx);
      });
      return;
    }
  } catch (err) {
    console.error('All weather services failed:', err);
    widgets.forEach(w => {
      w.innerHTML = `
        <div class="weather-loading" style="flex-direction: column; gap: 4px; padding: 0.25rem 0.5rem; text-align: center;">
          <span style="color: #ef4444; font-weight: 500;">Failed to fetch weather</span>
          <span style="font-size: 0.7rem; opacity: 0.8; color: hsl(var(--muted-foreground));">Click to retry</span>
        </div>
      `;
    });
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
  const temp = Math.round(weatherData.temperature);
  const desc = getWeatherDescription(weatherData.weathercode);
  const iconSvg = getWeatherIconSVG(weatherData.weathercode, index);
  
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
    
    if (!lat || !lon) {
      // If no location is set, switch to settings tab so they can configure it
      const settingsBtn = document.querySelector('[data-tab="settings-tab"]');
      if (settingsBtn) {
        settingsBtn.click();
      }
      return;
    }
    
    // Clear cache
    const tempFormat = state.currentSettings.tempFormat || 'fahrenheit';
    const cacheKey = `weather_${lat}_${lon}_${tempFormat}`;
    localStorage.removeItem(cacheKey);
    
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
