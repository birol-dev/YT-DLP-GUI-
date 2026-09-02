import { initSettingsUI } from './settings.js';
import { state } from './state.js';

// Dependency installer IPC listener
const depModal = document.getElementById('dependency-modal');
const depValYt = document.getElementById('dep-val-yt');
const depValFfmpeg = document.getElementById('dep-val-ffmpeg');
const depValFpcalc = document.getElementById('dep-val-fpcalc');
const depStatusYt = document.getElementById('dep-status-yt');
const depStatusFfmpeg = document.getElementById('dep-status-ffmpeg');
const depStatusFpcalc = document.getElementById('dep-status-fpcalc');
const depProgressContainer = document.getElementById('dependency-progress-container');
const depProgressText = document.getElementById('dep-progress-text');
const depProgressPercent = document.getElementById('dep-progress-percent');
const depProgressFill = document.getElementById('dep-progress-fill');

const btnDepContinue = document.getElementById('btn-dep-continue');
if (btnDepContinue) {
  btnDepContinue.addEventListener('click', () => {
    window.electronAPI.continueAnyway();
    if (depModal) {
      depModal.classList.remove('active');
    }
  });
}

if (depModal) {
  window.electronAPI.onDependencyStatus((data) => {
    // Check if we need to update the yt-dlp channel switch status details
    if (data.item === 'yt-dlp' && data.type === 'progress') {
      const channelStatusEl = document.getElementById('ytdlp-channel-status');
      if (channelStatusEl && channelStatusEl.style.display !== 'none' && channelStatusEl.classList.contains('testing')) {
        const detailEl = channelStatusEl.querySelector('.cookies-test-status-detail');
        if (detailEl) {
          detailEl.textContent = `Downloading target release binary: ${data.progress}%...`;
        }
      }
    }

    const onboardingModal = document.getElementById('onboarding-modal');
    const isOnboardingActive = onboardingModal && onboardingModal.classList.contains('active');
    
    if (isOnboardingActive) {
      if (typeof updateOnboardingDependencyStatus === 'function') {
        updateOnboardingDependencyStatus(data);
      }
      return;
    }

    switch (data.type) {
      case 'checking':
        depModal.classList.add('active');
        if (depValYt) depValYt.textContent = 'Verifying...';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Verifying...';
        if (depValFpcalc) depValFpcalc.textContent = 'Verifying...';
        break;

      case 'init':
        depModal.classList.add('active');
        
        // Update states based on what needs download
        if (data.needYtDlp) {
          if (depStatusYt) {
            depStatusYt.className = 'dependency-status-item downloading';
          }
          if (depValYt) depValYt.textContent = 'Awaiting download...';
        } else {
          if (depStatusYt) {
            depStatusYt.className = 'dependency-status-item completed';
          }
          if (depValYt) depValYt.textContent = 'Ready';
        }

        if (data.needFfmpeg) {
          if (depStatusFfmpeg) {
            depStatusFfmpeg.className = 'dependency-status-item downloading';
          }
          if (depValFfmpeg) depValFfmpeg.textContent = 'Awaiting download...';
        } else {
          if (depStatusFfmpeg) {
            depStatusFfmpeg.className = 'dependency-status-item completed';
          }
          if (depValFfmpeg) depValFfmpeg.textContent = 'Ready';
        }

        if (data.needFpcalc) {
          if (depStatusFpcalc) {
            depStatusFpcalc.className = 'dependency-status-item downloading';
          }
          if (depValFpcalc) depValFpcalc.textContent = 'Awaiting download...';
        } else {
          if (depStatusFpcalc) {
            depStatusFpcalc.className = 'dependency-status-item completed';
          }
          if (depValFpcalc) depValFpcalc.textContent = 'Ready';
        }
        break;

      case 'download-start':
        depModal.classList.add('active');
        if (depProgressContainer) depProgressContainer.style.display = 'block';
        if (depProgressFill) depProgressFill.style.width = '0%';
        if (depProgressPercent) depProgressPercent.textContent = '0%';
        
        if (data.item === 'yt-dlp') {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
          if (depValYt) depValYt.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading yt-dlp core...';
        } else if (data.item === 'ffmpeg') {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading FFmpeg utilities...';
        } else if (data.item === 'fpcalc') {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
          if (depValFpcalc) depValFpcalc.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading AcoustID fpcalc...';
        }
        break;

      case 'progress':
        if (depProgressFill) depProgressFill.style.width = `${data.progress}%`;
        if (depProgressPercent) depProgressPercent.textContent = `${data.progress}%`;
        
        if (data.item === 'yt-dlp') {
          if (depValYt) depValYt.textContent = `Downloading (${data.progress}%)...`;
        } else if (data.item === 'ffmpeg') {
          if (depValFfmpeg) depValFfmpeg.textContent = `Downloading (${data.progress}%)...`;
        } else if (data.item === 'fpcalc') {
          if (depValFpcalc) depValFpcalc.textContent = `Downloading (${data.progress}%)...`;
        }
        break;

      case 'extracting':
        if (depProgressFill) depProgressFill.style.width = '100%';
        if (depProgressPercent) depProgressPercent.textContent = '100%';
        if (data.item === 'fpcalc') {
          if (depProgressText) depProgressText.textContent = 'Extracting fpcalc binaries...';
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item extracting';
          if (depValFpcalc) depValFpcalc.textContent = 'Extracting...';
        } else {
          if (depProgressText) depProgressText.textContent = 'Extracting FFmpeg binaries...';
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item extracting';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Extracting...';
        }
        break;

      case 'download-complete':
        if (data.item === 'yt-dlp') {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
          if (depValYt) depValYt.textContent = 'Completed';
        } else if (data.item === 'ffmpeg') {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Completed';
        } else if (data.item === 'fpcalc') {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
          if (depValFpcalc) depValFpcalc.textContent = 'Completed';
        }
        break;

      case 'all-ready':
        if (depProgressText) depProgressText.textContent = 'Dependencies loaded. Launching...';
        if (depProgressFill) depProgressFill.style.width = '100%';
        if (depProgressPercent) depProgressPercent.textContent = '100%';
        
        // Final transition: remove active class to fade out the modal
        setTimeout(() => {
          depModal.classList.remove('active');
          if (depProgressContainer) depProgressContainer.style.display = 'none';
        }, 1200);
        break;

      case 'error':
        if (depProgressText) depProgressText.textContent = 'Setup Error!';
        if (depProgressPercent) depProgressPercent.textContent = 'Fail';
        
        if (depStatusYt && depStatusYt.classList.contains('downloading')) {
          depStatusYt.className = 'dependency-status-item error';
          if (depValYt) depValYt.textContent = 'Download failed';
        }
        if (depStatusFfmpeg && depStatusFfmpeg.classList.contains('downloading')) {
          depStatusFfmpeg.className = 'dependency-status-item error';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Download failed';
        }
        if (depStatusFpcalc && depStatusFpcalc.classList.contains('downloading')) {
          depStatusFpcalc.className = 'dependency-status-item error';
          if (depValFpcalc) depValFpcalc.textContent = 'Download failed';
        }
        
        alert(`Failed to configure dependencies:\n${data.message}\n\nPlease check your internet connection or install them manually.`);
        break;
    }
  });
}

// ==========================================
// Weather, Greetings & Onboarding Extension
// ==========================================

let onboardingCityData = null;

// Reusable City Search Autocomplete helper
export function setupCityAutocomplete(inputEl, resultsEl, onSelectCallback) {
  let debounceTimer;
  
  inputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    
    if (query.length < 2) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      return;
    }
    
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`);
        const data = await res.json();
        
        resultsEl.innerHTML = '';
        if (data.results && data.results.length > 0) {
          data.results.forEach(city => {
            const li = document.createElement('li');
            const region = city.admin1 ? `, ${city.admin1}` : '';
            const country = city.country ? `, ${city.country}` : '';
            const displayName = `${city.name}${region}${country}`;
            
            li.textContent = displayName;
            li.addEventListener('click', () => {
              inputEl.value = displayName;
              resultsEl.innerHTML = '';
              resultsEl.style.display = 'none';
              onSelectCallback({
                name: displayName,
                lat: city.latitude,
                lon: city.longitude
              });
            });
            resultsEl.appendChild(li);
          });
          resultsEl.style.display = 'block';
        } else {
          const li = document.createElement('li');
          li.className = 'no-results';
          li.textContent = 'No cities found';
          resultsEl.appendChild(li);
          resultsEl.style.display = 'block';
        }
      } catch (err) {
        console.error('Geocoding search failed:', err);
      }
    }, 300);
  });
  
  // Close results list on click outside
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && e.target !== resultsEl) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
    }
  });
}

let onboardingDataCollected = {};
let hasMissingDependencies = false;

export function updateOnboardingDependencyStatus(data) {
  const depStatusYt = document.getElementById('onboarding-dep-status-yt');
  const depStatusFfmpeg = document.getElementById('onboarding-dep-status-ffmpeg');
  const depStatusFpcalc = document.getElementById('onboarding-dep-status-fpcalc');
  
  const depValYt = document.getElementById('onboarding-dep-val-yt');
  const depValFfmpeg = document.getElementById('onboarding-dep-val-ffmpeg');
  const depValFpcalc = document.getElementById('onboarding-dep-val-fpcalc');
  
  const depProgressContainer = document.getElementById('onboarding-dep-progress-container');
  const depProgressText = document.getElementById('onboarding-dep-progress-text');
  const depProgressPercent = document.getElementById('onboarding-dep-progress-percent');
  const depProgressFill = document.getElementById('onboarding-dep-progress-fill');
  
  switch (data.type) {
    case 'checking':
      if (depValYt) depValYt.textContent = 'Verifying...';
      if (depValFfmpeg) depValFfmpeg.textContent = 'Verifying...';
      if (depValFpcalc) depValFpcalc.textContent = 'Verifying...';
      break;

    case 'init':
      if (data.needYtDlp) {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
        if (depValYt) depValYt.textContent = 'Awaiting download...';
      } else {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
        if (depValYt) depValYt.textContent = 'Ready';
      }

      if (data.needFfmpeg) {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Awaiting download...';
      } else {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Ready';
      }

      if (data.needFpcalc) {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
        if (depValFpcalc) depValFpcalc.textContent = 'Awaiting download...';
      } else {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
        if (depValFpcalc) depValFpcalc.textContent = 'Ready';
      }
      break;

    case 'download-start':
      if (depProgressContainer) depProgressContainer.style.display = 'block';
      if (depProgressFill) depProgressFill.style.width = '0%';
      if (depProgressPercent) depProgressPercent.textContent = '0%';
      
      if (data.item === 'yt-dlp') {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
        if (depValYt) depValYt.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading yt-dlp core...';
      } else if (data.item === 'ffmpeg') {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading FFmpeg utilities...';
      } else if (data.item === 'fpcalc') {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
        if (depValFpcalc) depValFpcalc.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading AcoustID fpcalc...';
      }
      break;

    case 'progress':
      if (depProgressFill) depProgressFill.style.width = `${data.progress}%`;
      if (depProgressPercent) depProgressPercent.textContent = `${data.progress}%`;
      
      if (data.item === 'yt-dlp') {
        if (depValYt) depValYt.textContent = `Downloading (${data.progress}%)...`;
      } else if (data.item === 'ffmpeg') {
        if (depValFfmpeg) depValFfmpeg.textContent = `Downloading (${data.progress}%)...`;
      } else if (data.item === 'fpcalc') {
        if (depValFpcalc) depValFpcalc.textContent = `Downloading (${data.progress}%)...`;
      }
      break;

    case 'extracting':
      if (depProgressFill) depProgressFill.style.width = '100%';
      if (depProgressPercent) depProgressPercent.textContent = '100%';
      if (data.item === 'fpcalc') {
        if (depProgressText) depProgressText.textContent = 'Extracting fpcalc...';
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item extracting';
        if (depValFpcalc) depValFpcalc.textContent = 'Extracting...';
      } else {
        if (depProgressText) depProgressText.textContent = 'Extracting FFmpeg...';
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item extracting';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Extracting...';
      }
      break;

    case 'download-complete':
      if (data.item === 'yt-dlp') {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
        if (depValYt) depValYt.textContent = 'Completed';
      } else if (data.item === 'ffmpeg') {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Completed';
      } else if (data.item === 'fpcalc') {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
        if (depValFpcalc) depValFpcalc.textContent = 'Completed';
      }
      break;

    case 'all-ready':
      if (depProgressText) depProgressText.textContent = 'Dependencies loaded. Launching...';
      if (depProgressFill) depProgressFill.style.width = '100%';
      if (depProgressPercent) depProgressPercent.textContent = '100%';
      
      setTimeout(() => {
        const modal = document.getElementById('onboarding-modal');
        if (modal) modal.classList.remove('active');
        if (depProgressContainer) depProgressContainer.style.display = 'none';
        initSettingsUI();
      }, 1200);
      break;

    case 'error':
      if (depProgressText) depProgressText.textContent = 'Setup Error!';
      if (depProgressPercent) depProgressPercent.textContent = 'Fail';
      
      const finishBtn = document.getElementById('btn-onboarding-finish');
      if (finishBtn) {
        finishBtn.disabled = false;
        finishBtn.textContent = 'Retry Install';
      }
      const backBtn3 = document.getElementById('btn-onboarding-back-3');
      if (backBtn3) backBtn3.disabled = false;
      
      if (depStatusYt && depStatusYt.classList.contains('downloading')) {
        depStatusYt.className = 'dependency-status-item error';
        if (depValYt) depValYt.textContent = 'Download failed';
      }
      if (depStatusFfmpeg && depStatusFfmpeg.classList.contains('downloading')) {
        depStatusFfmpeg.className = 'dependency-status-item error';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Download failed';
      }
      if (depStatusFpcalc && depStatusFpcalc.classList.contains('downloading')) {
        depStatusFpcalc.className = 'dependency-status-item error';
        if (depValFpcalc) depValFpcalc.textContent = 'Download failed';
      }
      
      alert(`Failed to configure dependencies:\n${data.message}\n\nPlease check your internet connection or install them manually.`);
      break;
  }
}

// Show Onboarding flow modal
export async function showOnboardingFlow() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.classList.add('active');
  
  // Populate system info placeholder in input
  const sysInfo = await window.electronAPI.getSystemInfo();
  const onboardingNameInput = document.getElementById('onboarding-name');
  if (onboardingNameInput && sysInfo.username) {
    onboardingNameInput.placeholder = sysInfo.username;
  }
  
  // Setup onboarding city autocomplete
  const onboardingCityInput = document.getElementById('onboarding-city');
  const onboardingCityResults = document.getElementById('onboarding-city-results');
  if (onboardingCityInput && onboardingCityResults) {
    setupCityAutocomplete(onboardingCityInput, onboardingCityResults, (data) => {
      onboardingCityData = data;
    });
  }

  // Set up Step 2 Dynamic Service Fields Toggling
  const musicServiceSelector = document.getElementById('onboarding-musicfinder-service');
  const acoustidContainer = document.getElementById('onboarding-acoustid-container');
  const acrcloudContainer = document.getElementById('onboarding-acrcloud-container');
  
  if (musicServiceSelector && acoustidContainer && acrcloudContainer) {
    musicServiceSelector.addEventListener('change', () => {
      if (musicServiceSelector.value === 'acoustid') {
        acoustidContainer.style.display = 'block';
        acrcloudContainer.style.display = 'none';
      } else {
        acoustidContainer.style.display = 'none';
        acrcloudContainer.style.display = 'flex';
      }
    });
  }

  // Navigation Steps helper
  const steps = [
    document.getElementById('onboarding-step-1'),
    document.getElementById('onboarding-step-2'),
    document.getElementById('onboarding-step-3')
  ];
  const pills = [
    document.getElementById('indicator-step-1'),
    document.getElementById('indicator-step-2'),
    document.getElementById('indicator-step-3')
  ];

  async function goToStep(stepNum) {
    steps.forEach((s, idx) => {
      if (s) s.style.display = (idx + 1 === stepNum) ? 'block' : 'none';
    });
    pills.forEach((p, idx) => {
      if (p) {
        if (idx + 1 === stepNum) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      }
    });

    if (stepNum === 3) {
      // Audit dependencies and display statuses
      const depStatusYt = document.getElementById('onboarding-dep-status-yt');
      const depStatusFfmpeg = document.getElementById('onboarding-dep-status-ffmpeg');
      const depStatusFpcalc = document.getElementById('onboarding-dep-status-fpcalc');
      const depValYt = document.getElementById('onboarding-dep-val-yt');
      const depValFfmpeg = document.getElementById('onboarding-dep-val-ffmpeg');
      const depValFpcalc = document.getElementById('onboarding-dep-val-fpcalc');
      const finishBtn = document.getElementById('btn-onboarding-finish');

      if (depValYt) depValYt.textContent = 'Checking...';
      if (depValFfmpeg) depValFfmpeg.textContent = 'Checking...';
      if (depValFpcalc) depValFpcalc.textContent = 'Checking...';

      try {
        const deps = await window.electronAPI.checkDependencies();
        hasMissingDependencies = !deps.ytDlp.available || !deps.ffmpeg.available || !deps.fpcalc.available;

        if (deps.ytDlp.available) {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
          if (depValYt) depValYt.textContent = 'Ready (Found)';
        } else {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
          if (depValYt) depValYt.textContent = 'Not found - will install';
        }

        if (deps.ffmpeg.available) {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Ready (Found)';
        } else {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Not found - will install';
        }

        if (deps.fpcalc.available) {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
          if (depValFpcalc) depValFpcalc.textContent = 'Ready (Found)';
        } else {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
          if (depValFpcalc) depValFpcalc.textContent = 'Not found - will install';
        }

        if (finishBtn) {
          if (hasMissingDependencies) {
            finishBtn.textContent = 'Install & Finish';
          } else {
            finishBtn.textContent = 'Finish & Launch';
          }
        }
      } catch (err) {
        console.error('Failed to run system audit:', err);
      }
    }
  }

  // STEP 1 BUTTONS
  const btnNext1 = document.getElementById('btn-onboarding-next-1');
  if (btnNext1) {
    btnNext1.addEventListener('click', async () => {
      btnNext1.disabled = true;
      btnNext1.textContent = 'Resolving Location...';

      const userName = onboardingNameInput.value.trim();
      const tempFormat = document.getElementById('onboarding-temp-format').value;
      
      let city = 'Estimated Location';
      let lat = 37.7749;
      let lon = -122.4194;
      
      if (onboardingCityData) {
        city = onboardingCityData.name;
        lat = onboardingCityData.lat;
        lon = onboardingCityData.lon;
      } else {
        const textCity = onboardingCityInput.value.trim();
        if (textCity.length >= 2) {
          try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(textCity)}&count=1&language=en&format=json`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              const firstCity = data.results[0];
              const region = firstCity.admin1 ? `, ${firstCity.admin1}` : '';
              const country = firstCity.country ? `, ${firstCity.country}` : '';
              city = `${firstCity.name}${region}${country}`;
              lat = firstCity.latitude;
              lon = firstCity.longitude;
            } else {
              const ipRes = await fetch('https://ipapi.co/json/');
              const ipData = await ipRes.json();
              if (ipData.city) {
                const region = ipData.region ? `, ${ipData.region}` : '';
                city = `${ipData.city}${region}`;
                lat = ipData.latitude;
                lon = ipData.longitude;
              }
            }
          } catch (e) {
            console.error('Failed to geocode typed location:', e);
          }
        } else {
          try {
            const ipRes = await fetch('https://ipapi.co/json/');
            const ipData = await ipRes.json();
            if (ipData.city) {
              const region = ipData.region ? `, ${ipData.region}` : '';
              city = `${ipData.city}${region}`;
              lat = ipData.latitude;
              lon = ipData.longitude;
            }
          } catch (err) {
            console.error('IP Geolocation failed:', err);
          }
        }
      }

      onboardingDataCollected.userName = userName;
      onboardingDataCollected.weatherCity = city;
      onboardingDataCollected.weatherLat = lat;
      onboardingDataCollected.weatherLon = lon;
      onboardingDataCollected.tempFormat = tempFormat;

      btnNext1.disabled = false;
      btnNext1.textContent = 'Next Step';

      goToStep(2);
    });
  }

  const btnSkip = document.getElementById('btn-onboarding-skip');
  if (btnSkip) {
    btnSkip.addEventListener('click', async () => {
      btnSkip.disabled = true;
      btnSkip.textContent = 'Estimating location...';
      
      let estCity = 'Estimated Location';
      let estLat = 37.7749;
      let estLon = -122.4194;
      
      try {
        const ipRes = await fetch('https://ipapi.co/json/');
        const ipData = await ipRes.json();
        if (ipData.city) {
          const region = ipData.region ? `, ${ipData.region}` : '';
          estCity = `${ipData.city}${region}`;
          estLat = ipData.latitude;
          estLon = ipData.longitude;
        }
      } catch (err) {
        console.error('IP Geolocation failed:', err);
      }
      
      const onboardingData = {
        userName: '',
        weatherCity: estCity,
        weatherLat: estLat,
        weatherLon: estLon,
        tempFormat: 'fahrenheit',
        musicFinderService: 'acoustid',
        acoustidKey: '',
        acrcloudKey: '',
        acrcloudSecret: '',
        acrcloudHost: 'identify-us-west-2.acrcloud.com'
      };
      
      await window.electronAPI.finishOnboarding(onboardingData);
      state.currentSettings = { ...state.currentSettings, ...onboardingData, onboardingComplete: true };
      
      modal.classList.remove('active');
      await initSettingsUI();
    });
  }

  // STEP 2 BUTTONS
  const btnBack2 = document.getElementById('btn-onboarding-back-2');
  if (btnBack2) {
    btnBack2.addEventListener('click', () => {
      goToStep(1);
    });
  }

  const btnSkip2 = document.getElementById('btn-onboarding-skip-2');
  if (btnSkip2) {
    btnSkip2.addEventListener('click', () => {
      onboardingDataCollected.musicFinderService = 'acoustid';
      onboardingDataCollected.acoustidKey = '';
      onboardingDataCollected.acrcloudKey = '';
      onboardingDataCollected.acrcloudSecret = '';
      onboardingDataCollected.acrcloudHost = 'identify-us-west-2.acrcloud.com';
      goToStep(3);
    });
  }

  const btnNext2 = document.getElementById('btn-onboarding-next-2');
  if (btnNext2) {
    btnNext2.addEventListener('click', () => {
      const service = document.getElementById('onboarding-musicfinder-service').value;
      const acoustidKey = document.getElementById('onboarding-acoustid-key').value.trim();
      const acrcloudKey = document.getElementById('onboarding-acrcloud-key').value.trim();
      const acrcloudSecret = document.getElementById('onboarding-acrcloud-secret').value.trim();
      const acrcloudHost = document.getElementById('onboarding-acrcloud-host').value.trim() || 'identify-us-west-2.acrcloud.com';

      onboardingDataCollected.musicFinderService = service;
      onboardingDataCollected.acoustidKey = acoustidKey;
      onboardingDataCollected.acrcloudKey = acrcloudKey;
      onboardingDataCollected.acrcloudSecret = acrcloudSecret;
      onboardingDataCollected.acrcloudHost = acrcloudHost;

      goToStep(3);
    });
  }

  // STEP 3 BUTTONS
  const btnBack3 = document.getElementById('btn-onboarding-back-3');
  if (btnBack3) {
    btnBack3.addEventListener('click', () => {
      goToStep(2);
    });
  }

  const btnFinish = document.getElementById('btn-onboarding-finish');
  if (btnFinish) {
    btnFinish.addEventListener('click', async () => {
      btnFinish.disabled = true;
      const backBtn3 = document.getElementById('btn-onboarding-back-3');
      if (backBtn3) backBtn3.disabled = true;

      // Save settings
      await window.electronAPI.finishOnboarding(onboardingDataCollected);
      state.currentSettings = { ...state.currentSettings, ...onboardingDataCollected, onboardingComplete: true };

      if (hasMissingDependencies) {
        btnFinish.textContent = 'Installing...';
        // The backend automatically triggers setupDependencies inside finish-onboarding handler,
        // which sends 'checking', 'init', progress bars, and finally 'all-ready' back to us!
      } else {
        // Close modal immediately since there are no missing dependencies
        modal.classList.remove('active');
        await initSettingsUI();
      }
    });
  }
}
