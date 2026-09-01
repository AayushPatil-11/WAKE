// Handles the Google Map, Places search box, and the draggable destination pin.
// Exposes window.WaypointMap so app.js can read the chosen destination.

// ==========================================================
// PASTE YOUR GOOGLE MAPS API KEY BELOW
// ==========================================================
const WAYPOINT_GOOGLE_MAPS_API_KEY = 'AIzaSyBMtjWIn8EIgBQ8MVgg6b55bwDK4-zk-s0';

window.WaypointMap = (function () {
  let map, marker, geocoder;
  let destination = null; // { lat, lng, label }
  const onChangeCallbacks = [];

  function init() {
    const center = { lat: 12.9716, lng: 77.5946 }; // default: Bengaluru

    map = new google.maps.Map(document.getElementById('map'), {
      center,
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      styles: NIGHT_MAP_STYLE,
    });

    marker = new google.maps.Marker({
      map,
      draggable: true,
      visible: false,
    });

    geocoder = new google.maps.Geocoder();

    const input = document.getElementById('place-search');
    const autocomplete = new google.maps.places.Autocomplete(input, {
      fields: ['geometry', 'name', 'formatted_address'],
    });
    autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry || !place.geometry.location) return;
      const loc = place.geometry.location;
      setDestination(loc.lat(), loc.lng(), place.name || place.formatted_address);
      map.panTo(loc);
      map.setZoom(16);
    });

    map.addListener('click', (e) => {
      reverseGeocodeAndSet(e.latLng.lat(), e.latLng.lng());
    });

    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      reverseGeocodeAndSet(pos.lat(), pos.lng());
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 4000 }
      );
    }
  }

  function reverseGeocodeAndSet(lat, lng) {
    setDestination(lat, lng, null);
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results[0]) {
        destination.label = results[0].formatted_address;
        notify();
      }
    });
  }

  function setDestination(lat, lng, label) {
    destination = { lat, lng, label: label || `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    marker.setPosition({ lat, lng });
    marker.setVisible(true);
    notify();
  }

  function notify() {
    onChangeCallbacks.forEach((cb) => cb(destination));
  }

  function onChange(cb) {
    onChangeCallbacks.push(cb);
  }

  function getDestination() {
    return destination;
  }

  const NIGHT_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#121A29' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0F1A' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8592AC' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1B2740' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#263148' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0D1420' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#182238' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#182238' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#263148' }] },
  ];

  return { init, onChange, getDestination, setDestination };
})();

// Load the Google Maps script ourselves, once WaypointMap above is already
// fully defined — this avoids any <script> tag ordering/timing race.
(function loadGoogleMaps() {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    WAYPOINT_GOOGLE_MAPS_API_KEY
  )}&libraries=places`;
  script.onload = () => window.WaypointMap.init();
  script.onerror = () =>
    console.error('Failed to load Google Maps script — check your API key, that billing is enabled, and your network connection.');
  document.head.appendChild(script);
})();