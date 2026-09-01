(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    destination: null,   // { lat, lng, label }
    radiusMeters: 400,
    soundFile: null,     // File object (foreground) or path (native)
    soundObjectUrl: null,
    armed: false,
    alarmFiring: false,
    watcherId: null,      // browser geolocation.watchPosition id
    nativeWatcherId: null, // Capacitor background-geolocation watcher id
  };

  const el = (id) => document.getElementById(id);
  const screens = {
    destination: el('screen-destination'),
    sound: el('screen-sound'),
    armed: el('screen-armed'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => (s.dataset.active = 'false'));
    screens[name].dataset.active = 'true';
  }

  // ---------------------------------------------------------------------
  // Step 1 — Destination
  // ---------------------------------------------------------------------
  window.WaypointMap.onChange((destination) => {
    state.destination = destination;
    el('btn-to-sound').disabled = !destination;
    el('btn-to-sound').textContent = destination ? 'Continue →' : 'Drop pin, then continue →';
  });

  const radiusInput = el('radius');
  radiusInput.addEventListener('input', () => {
    state.radiusMeters = Number(radiusInput.value);
    el('radius-value').textContent = `${state.radiusMeters} m`;
  });

  el('btn-to-sound').addEventListener('click', () => showScreen('sound'));

  // ---------------------------------------------------------------------
  // Step 2 — Sound
  // ---------------------------------------------------------------------
  const soundInput = el('sound-input');
  soundInput.addEventListener('change', () => {
    const file = soundInput.files[0];
    if (!file) return;
    state.soundFile = file;
    if (state.soundObjectUrl) URL.revokeObjectURL(state.soundObjectUrl);
    state.soundObjectUrl = URL.createObjectURL(file);
    el('alarm-audio').src = state.soundObjectUrl;

    el('file-drop-label').textContent = 'Change audio file…';
    el('sound-filename').textContent = file.name;
    el('sound-preview').hidden = false;
    el('btn-to-arm').disabled = false;
  });

  el('btn-preview').addEventListener('click', () => {
    const audio = el('alarm-audio');
    audio.loop = false;
    audio.currentTime = 0;
    audio.play();
  });

  el('btn-back-to-dest').addEventListener('click', () => showScreen('destination'));

  el('btn-to-arm').addEventListener('click', () => {
    arm();
    showScreen('armed');
  });

  // ---------------------------------------------------------------------
  // Step 3 — Arm & track
  // ---------------------------------------------------------------------
  function arm() {
    state.armed = true;
    el('stat-destination').textContent = state.destination.label;
    el('stat-radius').textContent = `${state.radiusMeters} m`;
    startTracking();
  }

  function disarm() {
    state.armed = false;
    stopTracking();
    stopAlarm();
    showScreen('destination');
  }
  el('btn-disarm').addEventListener('click', disarm);
  el('btn-stop-alarm').addEventListener('click', stopAlarm);

  // ---- Tracking: browser geolocation (works while tab/app is foregrounded) ----
  function startTracking() {
    if (!navigator.geolocation) {
      el('armed-status').textContent = 'NO GPS';
      return;
    }
    el('armed-status').textContent = 'LIVE';
    state.watcherId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });

    // If running inside the Capacitor-wrapped native app, also start the
    // native background watcher so tracking survives the screen locking
    // or the app being backgrounded. See README for plugin setup.
    startNativeBackgroundWatch();
  }

  function stopTracking() {
    if (state.watcherId != null) {
      navigator.geolocation.clearWatch(state.watcherId);
      state.watcherId = null;
    }
    stopNativeBackgroundWatch();
  }

  function onPosition(position) {
    const { latitude, longitude } = position.coords;
    updateDistance(latitude, longitude);
  }

  function onPositionError(err) {
    el('armed-status').textContent = 'GPS ERROR';
    console.error('Geolocation error', err);
  }

  function updateDistance(lat, lng) {
    if (!state.destination) return;
    const dist = haversineMeters(lat, lng, state.destination.lat, state.destination.lng);
    el('readout-distance').textContent = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;

    // Move the radar ping inward as distance shrinks (purely visual, capped)
    const maxRadarDist = Math.max(state.radiusMeters * 4, 2000);
    const t = Math.min(dist / maxRadarDist, 1);
    const ringRadius = 60 + t * 90; // between center ring (60) and outer ring (150)
    const angle = (Date.now() / 20) % 360; // gentle continuous motion
    const rad = (angle * Math.PI) / 180;
    const cx = 160 + ringRadius * Math.cos(rad);
    const cy = 160 + ringRadius * Math.sin(rad);
    el('ping').setAttribute('cx', cx);
    el('ping').setAttribute('cy', cy);

    if (dist <= state.radiusMeters && !state.alarmFiring) {
      fireAlarm(dist);
    }
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------------------------------------------------------------------
  // Alarm
  // ---------------------------------------------------------------------
  function fireAlarm(distance) {
    state.alarmFiring = true;
    el('alarm-sub').textContent = `You're ${Math.round(distance)} m from ${state.destination.label}.`;
    el('alarm-overlay').hidden = false;

    const audio = el('alarm-audio');
    audio.loop = true;
    audio.currentTime = 0;
    audio.play().catch((e) => console.warn('Autoplay blocked until user interaction', e));

    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);

    // Also fire a native local notification so it wakes you even if the
    // screen is locked and this page isn't visible. See fireNativeAlarm().
    fireNativeAlarm(distance);

    // Fallback: a normal Web Notification if the app happens to be open
    // in a background tab (works without any native wrapper at all).
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Waypoint — you have arrived', {
        body: `Within ${state.radiusMeters} m of ${state.destination.label}`,
        tag: 'waypoint-alarm',
      });
    }
  }

  function stopAlarm() {
    state.alarmFiring = false;
    el('alarm-overlay').hidden = true;
    const audio = el('alarm-audio');
    audio.pause();
    audio.currentTime = 0;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  // ---------------------------------------------------------------------
  // Native (Capacitor) hooks — no-ops in a plain browser/PWA context.
  // These only do anything once this app is wrapped with Capacitor and
  // the plugins below are installed. See README.md for setup.
  // ---------------------------------------------------------------------
  async function startNativeBackgroundWatch() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    try {
      const { BackgroundGeolocation } = await import(
        '@capacitor-community/background-geolocation'
      );
      state.nativeWatcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'Waypoint is tracking your trip',
          backgroundMessage: `Watching for ${state.destination.label}`,
          requestPermissions: true,
          stale: false,
          distanceFilter: 15,
        },
        (location, error) => {
          if (error) {
            console.error('Background geolocation error', error);
            return;
          }
          updateDistance(location.latitude, location.longitude);
        }
      );
    } catch (e) {
      console.warn('Background geolocation plugin not available', e);
    }
  }

  async function stopNativeBackgroundWatch() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform() || state.nativeWatcherId == null) return;
    try {
      const { BackgroundGeolocation } = await import(
        '@capacitor-community/background-geolocation'
      );
      await BackgroundGeolocation.removeWatcher({ id: state.nativeWatcherId });
      state.nativeWatcherId = null;
    } catch (e) {
      console.warn('Failed to stop background watcher', e);
    }
  }

  async function fireNativeAlarm(distance) {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 1,
            title: 'You have arrived',
            body: `Within ${state.radiusMeters} m of ${state.destination.label}`,
            channelId: 'waypoint-alarm', // high-importance channel with custom sound, see README
            sound: 'alarm_sound.wav',
            ongoing: true,
          },
        ],
      });
    } catch (e) {
      console.warn('Local notifications plugin not available', e);
    }
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW registration failed', e));
  }
})();
