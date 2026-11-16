const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { rootDir } = require('./helpers/source');

const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

describe('Weather, settings and onboarding fixes', () => {
  const settings = read('renderer/settings.js');
  const weather = read('renderer/weather.js');
  const onboarding = read('renderer/onboarding.js');
  const privacy = read('website/privacy.html');

  test('a hand-typed city is never saved with the previous city coordinates', () => {
    const collect = settings.slice(
      settings.indexOf('export function collectCurrentSettingsFromUI'),
      settings.indexOf('async function resolveTypedCity')
    );
    assert.match(collect, /city = settingsCityInputVal;\s*lat = null;\s*lon = null;/);
    assert.match(settings, /await resolveTypedCity\(newSettings\)/);
  });

  test('a save requested during an in-flight save is queued and re-run', () => {
    assert.doesNotMatch(settings, /if \(state\.isAutoSaving \|\| state\.isInitializingSettingsUI\) return;/);
    assert.match(settings, /if \(state\.isAutoSaving\) \{\s*saveQueued = true;/);
    assert.match(settings, /finally \{\s*state\.isAutoSaving = false;\s*\}\s*if \(saveQueued\)/);
  });

  test('saving weather or name changes refreshes the widget and greeting', () => {
    assert.match(settings, /clearWeatherCache\(\);\s*initWeatherAndClock\(\);/);
    assert.match(settings, /refreshGreeting\(\)/);
  });

  test('onboarding no longer invents a San Francisco location', () => {
    assert.doesNotMatch(onboarding, /37\.7749/);
    assert.doesNotMatch(onboarding, /-122\.4194/);
    assert.match(onboarding, /onboardingCityData = null;/);
  });

  test('weather widget escapes interpolated strings and rejects malformed payloads', () => {
    assert.match(weather, /city = escapeHtml\(city\)/);
    assert.match(weather, /escapeHtml\(getWeatherDescription/);
    assert.match(weather, /throw new Error\('wttr\.in returned no current_condition data'\)/);
  });

  test('audio format descriptions match what yt-dlp actually produces', () => {
    assert.doesNotMatch(settings, /24-bit PCM/);
    assert.doesNotMatch(settings, /320kbps Level 0 VBR/);
    assert.match(settings, /WAV \(16-bit PCM\)/);
  });

  test('privacy page names the weather hosts and the default-on behaviour', () => {
    assert.doesNotMatch(privacy, /if you turn it on/);
    assert.match(privacy, /on by default/);
    assert.match(privacy, /ipapi\.co/);
    assert.match(privacy, /Open-Meteo/);
  });
});
