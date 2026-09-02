// Shared renderer state. Modules mutate these properties directly.
export const state = {
  isDownloading: false,
  settingsCityData: null,
  downloadProgressState: {
    mode: 'single',
    currentItem: 1,
    totalItems: 1,
    itemPercent: 0,
    itemTitle: '',
    playlistTitle: ''
  },
  activeDownloadInfo: {
    url: '',
    type: 'video',
    quality: '',
    badge: '',
    title: '',
    phase: '',
    speed: '',
    eta: '',
    size: '',
    percent: 0
  },
  currentSettings: {},
  selectedAccent: 'default',
  autoSaveTimer: null,
  isAutoSaving: false,
  isInitializingSettingsUI: false
};
