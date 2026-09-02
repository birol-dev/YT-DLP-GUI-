export function getWeatherIconSVG(weatherCode, index) {
  const suffix = index !== undefined ? `-${index}` : '';
  if (weatherCode === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="sun-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF275" />
          <stop offset="30%" stop-color="#FFAE00" />
          <stop offset="100%" stop-color="#FF5100" />
        </linearGradient>
      </defs>
      <g class="weather-animate-spin">
        <path d="M12,2 L12,4 M12,20 L12,22 M4.22,4.22 L5.64,5.64 M18.36,18.36 L19.78,19.78 M2,12 L4,12 M20,12 L22,12 M4.22,19.78 L5.64,18.36 M18.36,5.64 L19.78,4.22" 
              stroke="url(#sun-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <circle cx="12" cy="12" r="5.5" fill="url(#sun-grad${suffix})" />
      <circle cx="10.5" cy="10.5" r="2.5" fill="#FFF" opacity="0.35" />
    </svg>`;
  }
  if ([1, 2, 3].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="cloud-sun-sun-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF066" />
          <stop offset="100%" stop-color="#FF7300" />
        </linearGradient>
        <linearGradient id="cloud-sun-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="100%" stop-color="#A5C2F1" />
        </linearGradient>
        <filter id="cloud-shadow${suffix}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.2" />
        </filter>
      </defs>
      <g transform="translate(3, -2)" class="weather-animate-spin">
        <circle cx="12" cy="12" r="4.5" fill="url(#cloud-sun-sun-grad${suffix})" />
        <path d="M12,4 L12,2 M12,22 L12,20 M4.22,4.22 L5.64,5.64 M18.36,18.36 L19.78,19.78 M2,12 L4,12 M20,12 L22,12 M4.22,19.78 L5.64,18.36 M18.36,5.64 L19.78,4.22" 
              stroke="url(#cloud-sun-sun-grad${suffix})" stroke-width="1.8" stroke-linecap="round" opacity="0.85" />
      </g>
      <path class="weather-animate-float" d="M17.5,18 A4.5,4.5 0 0,0 20,10.2 A6,6 0 0,0 8.5,8 A5,5 0 0,0 4,12.8 A4.5,4.5 0 0,0 6.5,18 Z" 
            fill="url(#cloud-sun-cloud-grad${suffix})" filter="url(#cloud-shadow${suffix})" />
    </svg>`;
  }
  if ([45, 48].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="fog-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#E2EDF8" />
          <stop offset="100%" stop-color="#8BB0D4" />
        </linearGradient>
        <linearGradient id="fog-line-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#8BB0D4" stop-opacity="0.2" />
          <stop offset="50%" stop-color="#C5D7EC" stop-opacity="1" />
          <stop offset="100%" stop-color="#8BB0D4" stop-opacity="0.2" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,15.5 A4.5,4.5 0 0,0 20,7.7 A6,6 0 0,0 8.5,5.5 A5,5 0 0,0 4,10.3 A4.5,4.5 0 0,0 6.5,15.5 Z" 
            fill="url(#fog-cloud-grad${suffix})" opacity="0.85" />
      <g class="weather-animate-pulse">
        <line x1="3" y1="16" x2="21" y2="16" stroke="url(#fog-line-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
        <line x1="5" y1="19.5" x2="19" y2="19.5" stroke="url(#fog-line-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([51, 53, 55, 56, 57].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="drizzle-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#BACDDC" />
          <stop offset="100%" stop-color="#698FA8" />
        </linearGradient>
        <linearGradient id="drop-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7CD3FC" />
          <stop offset="100%" stop-color="#0284C7" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,15 A4.5,4.5 0 0,0 20,7.2 A6,6 0 0,0 8.5,5 A5,5 0 0,0 4,9.8 A4.5,4.5 0 0,0 6.5,15 Z" 
            fill="url(#drizzle-cloud-grad${suffix})" />
      <g class="weather-animate-rain">
        <line x1="8" y1="17" x2="7" y2="20" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
        <line x1="12" y1="18" x2="11" y2="21" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
        <line x1="16" y1="17" x2="15" y2="20" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="rain-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#8EA2B3" />
          <stop offset="100%" stop-color="#475C6D" />
        </linearGradient>
        <linearGradient id="rain-drop-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38BDF8" />
          <stop offset="100%" stop-color="#0284C7" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#rain-cloud-grad${suffix})" />
      <g class="weather-animate-rain">
        <line x1="9" y1="16" x2="7.5" y2="21" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
        <line x1="13" y1="17" x2="11.5" y2="22" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
        <line x1="17" y1="16" x2="15.5" y2="21" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="snow-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#EBF4FC" />
          <stop offset="100%" stop-color="#B0CBE5" />
        </linearGradient>
        <linearGradient id="snow-flake-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="100%" stop-color="#7DD3FC" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#snow-cloud-grad${suffix})" />
      <g class="weather-animate-rain" stroke="url(#snow-flake-grad${suffix})" stroke-width="1.8" stroke-linecap="round">
        <g transform="translate(8, 18)">
          <line x1="0" y1="-2.5" x2="0" y2="2.5" />
          <line x1="-2.5" y1="0" x2="2.5" y2="0" />
          <line x1="-1.7" y1="-1.7" x2="1.7" y2="1.7" />
          <line x1="-1.7" y1="1.7" x2="1.7" y2="-1.7" />
        </g>
        <g transform="translate(13, 19.5)">
          <line x1="0" y1="-2" x2="0" y2="2" />
          <line x1="-2" y1="0" x2="2" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="1.4" y2="1.4" />
          <line x1="-1.4" y1="1.4" x2="1.4" y2="-1.4" />
        </g>
        <g transform="translate(18, 17.5)">
          <line x1="0" y1="-2" x2="0" y2="2" />
          <line x1="-2" y1="0" x2="2" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="1.4" y2="1.4" />
          <line x1="-1.4" y1="1.4" x2="1.4" y2="-1.4" />
        </g>
      </g>
    </svg>`;
  }
  if ([95, 96, 99].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="thunder-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#555A6E" />
          <stop offset="100%" stop-color="#232733" />
        </linearGradient>
        <linearGradient id="bolt-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF59D" />
          <stop offset="50%" stop-color="#FBC02D" />
          <stop offset="100%" stop-color="#F57F17" />
        </linearGradient>
        <filter id="bolt-glow${suffix}" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#thunder-cloud-grad${suffix})" />
      <polygon class="weather-animate-pulse" points="12,12 8,17 11,17 9,23 15,16 12,16" 
               fill="url(#bolt-grad${suffix})" filter="url(#bolt-glow${suffix})" />
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <defs>
      <linearGradient id="default-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFFFFF" />
        <stop offset="100%" stop-color="#A2C3E7" />
      </linearGradient>
      <filter id="cloud-shadow-simple${suffix}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.15" />
      </filter>
    </defs>
    <path class="weather-animate-float" d="M17.5,15 A4.5,4.5 0 0,0 20,7.2 A6,6 0 0,0 8.5,5 A5,5 0 0,0 4,9.8 A4.5,4.5 0 0,0 6.5,15 Z" 
          fill="url(#default-cloud-grad${suffix})" filter="url(#cloud-shadow-simple${suffix})" />
  </svg>`;
}
