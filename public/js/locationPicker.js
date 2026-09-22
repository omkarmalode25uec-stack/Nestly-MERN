/**
 * Nestly Mapbox Property Location Picker
 * 
 * Provides interactive search autocomplete, browser geolocation,
 * draggable map marker, reverse geocoding, and structured coordinate capture.
 */
(function () {
  const container = document.getElementById('mapboxLocationPicker');
  if (!container) return;

  const mapboxToken = container.dataset.token || '';
  if (!mapboxToken || mapboxToken === 'undefined') {
    console.warn('[Nestly] Mapbox access token is not configured in .env');
    const alertBox = document.getElementById('locationAlertContainer');
    if (alertBox) {
      alertBox.innerHTML =
        '<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">' +
        '  <span class="material-symbols-outlined text-amber-600 text-[18px]">info</span>' +
        '  <span>Mapbox location picker requires MAPBOX_ACCESS_TOKEN in .env. Manual address fields are enabled.</span>' +
        '</div>';
      alertBox.classList.remove('hidden');
    }
    return;
  }

  if (typeof mapboxgl === 'undefined') {
    console.error('[Nestly] Mapbox GL JS library is not loaded');
    return;
  }

  mapboxgl.accessToken = mapboxToken;

  // DOM Elements
  const mapElement = document.getElementById('mapboxMapContainer');
  const searchInput = document.getElementById('mapboxSearchInput');
  const searchClearBtn = document.getElementById('mapboxSearchClearBtn');
  const suggestionsList = document.getElementById('mapboxSuggestionsList');
  const useCurrentLocationBtn = document.getElementById('useCurrentLocationBtn');
  const chooseOnMapBtn = document.getElementById('chooseOnMapBtn');
  const alertContainer = document.getElementById('locationAlertContainer');
  
  // Confirmation card & form inputs
  const confirmationCard = document.getElementById('locationConfirmationCard');
  const confirmedAddressText = document.getElementById('confirmedAddressText');
  const confirmedLatText = document.getElementById('confirmedLatText');
  const confirmedLngText = document.getElementById('confirmedLngText');
  const changeLocationBtn = document.getElementById('changeLocationBtn');
  
  const latitudeInput = document.getElementById('latitudeInput');
  const longitudeInput = document.getElementById('longitudeInput');
  const addressInput = document.getElementById('address');
  const localityInput = document.getElementById('locality');

  // Optional Google Maps Link toggle
  const toggleGoogleMapsBtn = document.getElementById('toggleGoogleMapsUrlBtn');
  const googleMapsContainer = document.getElementById('googleMapsUrlContainer');

  if (toggleGoogleMapsBtn && googleMapsContainer) {
    toggleGoogleMapsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      googleMapsContainer.classList.toggle('hidden');
    });
  }

  // Kopargaon Default Reference Coordinates
  const DEFAULT_LAT = 19.8913;
  const DEFAULT_LNG = 74.4784;

  const initialLat = latitudeInput && latitudeInput.value ? parseFloat(latitudeInput.value) : null;
  const initialLng = longitudeInput && longitudeInput.value ? parseFloat(longitudeInput.value) : null;
  const hasInitialCoords = initialLat !== null && initialLng !== null && !isNaN(initialLat) && !isNaN(initialLng);

  const startCoords = hasInitialCoords ? [initialLng, initialLat] : [DEFAULT_LNG, DEFAULT_LAT];
  const startZoom = hasInitialCoords ? 15 : 13.5;

  // Initialize Mapbox GL Map
  const map = new mapboxgl.Map({
    container: mapElement,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: startCoords,
    zoom: startZoom
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');

  // Interactive Marker (Draggable Nestly Green Marker)
  const marker = new mapboxgl.Marker({
    draggable: true,
    color: '#006a4e'
  })
    .setLngLat(startCoords)
    .addTo(map);

  function showAlert(message, type) {
    if (!alertContainer) return;
    const isError = type !== 'warning' && type !== 'info';
    const bgClass = isError
      ? 'bg-red-50 border-red-200 text-red-800'
      : 'bg-amber-50 border-amber-200 text-amber-900';
    const icon = isError ? 'error' : 'info';

    alertContainer.innerHTML =
      '<div class="p-3 rounded-xl border ' + bgClass + ' text-xs flex items-center justify-between gap-2 transition-all">' +
      '  <div class="flex items-center gap-2">' +
      '    <span class="material-symbols-outlined text-[18px] shrink-0">' + icon + '</span>' +
      '    <span>' + message + '</span>' +
      '  </div>' +
      '  <button type="button" class="alert-close-btn text-on-surface-variant hover:text-on-surface font-bold text-sm leading-none cursor-pointer">&times;</button>' +
      '</div>';
    alertContainer.classList.remove('hidden');

    const closeBtn = alertContainer.querySelector('.alert-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        clearAlert();
      });
    }
  }

  function clearAlert() {
    if (alertContainer) {
      alertContainer.innerHTML = '';
      alertContainer.classList.add('hidden');
    }
  }

  function updateConfirmationUI(address, lat, lng) {
    const numLat = Number(lat);
    const numLng = Number(lng);

    if (latitudeInput) latitudeInput.value = numLat.toFixed(6);
    if (longitudeInput) longitudeInput.value = numLng.toFixed(6);

    if (confirmedLatText) confirmedLatText.textContent = numLat.toFixed(5);
    if (confirmedLngText) confirmedLngText.textContent = numLng.toFixed(5);
    if (confirmedAddressText) confirmedAddressText.textContent = address || 'Selected Location in Kopargaon';

    if (confirmationCard) confirmationCard.classList.remove('hidden');
  }

  // Reverse Geocoding Helper (Mapbox expects longitude,latitude in URL)
  async function reverseGeocode(lng, lat, updateAddressFields) {
    try {
      const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
        encodeURIComponent(lng) + ',' + encodeURIComponent(lat) +
        '.json?access_token=' + encodeURIComponent(mapboxToken) + '&country=IN';

      const res = await fetch(url);
      if (!res.ok) throw new Error('Reverse geocoding HTTP error ' + res.status);
      const data = await res.json();

      let placeName = '';
      let localityName = '';

      if (data.features && data.features.length > 0) {
        const topFeature = data.features[0];
        placeName = topFeature.place_name || '';

        // Extract locality or neighborhood context
        if (topFeature.context && Array.isArray(topFeature.context)) {
          const localityContext = topFeature.context.find(function (c) {
            return c.id.startsWith('locality') || c.id.startsWith('neighborhood') || c.id.startsWith('subdistrict');
          });
          if (localityContext) localityName = localityContext.text;
        }
        if (!localityName && topFeature.text) {
          localityName = topFeature.text;
        }
      }

      if (!placeName) {
        placeName = 'Kopargaon (' + Number(lat).toFixed(4) + ', ' + Number(lng).toFixed(4) + ')';
      }
      if (!localityName) {
        localityName = 'Kopargaon';
      }

      if (updateAddressFields) {
        if (addressInput) {
          addressInput.value = placeName;
        }
        if (localityInput && (!localityInput.value || localityInput.value === 'Kopargaon')) {
          localityInput.value = localityName;
        }
        if (searchInput && !searchInput.value) {
          searchInput.value = placeName;
        }
      }

      updateConfirmationUI(placeName, lat, lng);
      return { placeName: placeName, localityName: localityName };
    } catch (err) {
      console.warn('[Nestly] Reverse geocoding error:', err.message);
      const fallbackAddress = 'Pinned Location (' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + ')';
      updateConfirmationUI(fallbackAddress, lat, lng);
      return null;
    }
  }

  // Handle marker dragend
  marker.on('dragend', function () {
    clearAlert();
    const lngLat = marker.getLngLat();
    reverseGeocode(lngLat.lng, lngLat.lat, true);
  });

  // Handle map click
  map.on('click', function (e) {
    clearAlert();
    const lng = e.lngLat.lng;
    const lat = e.lngLat.lat;
    marker.setLngLat([lng, lat]);
    reverseGeocode(lng, lat, true);
  });

  // If already had saved coordinates on page load (e.g. edit page), populate UI
  if (hasInitialCoords) {
    const existingAddress = addressInput ? addressInput.value : '';
    updateConfirmationUI(existingAddress, initialLat, initialLng);
  }

  // ==========================================
  // 1. LOCATION SEARCH AUTOCOMPLETE
  // ==========================================
  let debounceTimeout = null;

  if (searchInput && suggestionsList) {
    searchInput.addEventListener('input', function () {
      const query = this.value.trim();
      clearTimeout(debounceTimeout);

      if (searchClearBtn) {
        searchClearBtn.classList.toggle('hidden', query.length === 0);
      }

      // Minimum 2-3 characters required before searching
      if (query.length < 2) {
        suggestionsList.innerHTML = '';
        suggestionsList.classList.add('hidden');
        return;
      }

      // 1. Show immediate "Searching..." loading state
      suggestionsList.innerHTML =
        '<li class="p-3 text-xs text-on-surface-variant text-center flex items-center justify-center gap-2">' +
        '  <span class="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>' +
        '  <span>Searching...</span>' +
        '</li>';
      suggestionsList.classList.remove('hidden');

      // 2. Debounce request (300ms)
      debounceTimeout = setTimeout(async function () {
        try {
          const forwardUrl = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
            encodeURIComponent(query) + '.json' +
            '?access_token=' + encodeURIComponent(mapboxToken) +
            '&country=IN' +
            '&proximity=' + DEFAULT_LNG + ',' + DEFAULT_LAT +
            '&autocomplete=true' +
            '&limit=5';

          const res = await fetch(forwardUrl);
          if (!res.ok) throw new Error('Search HTTP error ' + res.status);
          const data = await res.json();

          // Empty result state
          if (!data.features || data.features.length === 0) {
            suggestionsList.innerHTML =
              '<li class="p-3 text-xs text-on-surface-variant text-center">' +
              '  No locations found' +
              '</li>';
            suggestionsList.classList.remove('hidden');
            return;
          }

          // Render suggestions list
          let html = '';
          data.features.forEach(function (feature, idx) {
            const mainText = feature.text || feature.place_name || '';
            const subText = feature.place_name || '';
            html +=
              '<li data-index="' + idx + '" class="p-2.5 hover:bg-surface-container cursor-pointer border-b border-outline-variant/20 last:border-0 flex items-start gap-2 transition-colors">' +
              '  <span class="material-symbols-outlined text-primary text-[18px] mt-0.5 shrink-0">location_on</span>' +
              '  <div class="min-w-0 flex-1">' +
              '    <div class="font-label-md text-label-md font-bold text-on-surface truncate">' + escapeHtml(mainText) + '</div>' +
              '    <div class="text-[11px] text-on-surface-variant truncate">' + escapeHtml(subText) + '</div>' +
              '  </div>' +
              '</li>';
          });
          suggestionsList.innerHTML = html;
          suggestionsList.classList.remove('hidden');

          // Attach selection listeners
          const items = suggestionsList.querySelectorAll('li[data-index]');
          items.forEach(function (item) {
            item.addEventListener('click', function () {
              const idx = parseInt(this.dataset.index, 10);
              const selected = data.features[idx];
              if (!selected || !selected.center) return;

              const lng = selected.center[0];
              const lat = selected.center[1];
              const placeName = selected.place_name || selected.text || '';

              // Set search input value and hide dropdown
              searchInput.value = placeName;
              suggestionsList.classList.add('hidden');
              if (searchClearBtn) searchClearBtn.classList.remove('hidden');

              // Move map and marker
              map.flyTo({ center: [lng, lat], zoom: 16 });
              marker.setLngLat([lng, lat]);

              // Update address field
              if (addressInput) {
                addressInput.value = placeName;
              }

              // Update locality field
              if (localityInput) {
                let loc = selected.text || '';
                if (selected.context && Array.isArray(selected.context)) {
                  const c = selected.context.find(function (x) {
                    return x.id.startsWith('locality') || x.id.startsWith('neighborhood') || x.id.startsWith('subdistrict');
                  });
                  if (c) loc = c.text;
                }
                localityInput.value = loc || 'Kopargaon';
              }

              // Update coordinates & confirmation UI
              updateConfirmationUI(placeName, lat, lng);
              clearAlert();
            });
          });
        } catch (err) {
          console.warn('[Nestly] Mapbox search error:', err.message);
          suggestionsList.innerHTML =
            '<li class="p-3 text-xs text-on-surface-variant text-center">' +
            '  Unable to complete search. Please try again or select on the map.' +
            '</li>';
          suggestionsList.classList.remove('hidden');
        }
      }, 300);
    });

    // Clear search button
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', function () {
        searchInput.value = '';
        suggestionsList.innerHTML = '';
        suggestionsList.classList.add('hidden');
        this.classList.add('hidden');
        searchInput.focus();
      });
    }

    // Close suggestions dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!searchInput.contains(e.target) && !suggestionsList.contains(e.target)) {
        suggestionsList.classList.add('hidden');
      }
    });

    // Close suggestions dropdown on Escape key
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        suggestionsList.classList.add('hidden');
      }
    });
  }

  // Helper to escape HTML characters
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // 2. USE MY CURRENT LOCATION
  // ==========================================
  if (useCurrentLocationBtn) {
    useCurrentLocationBtn.addEventListener('click', function (e) {
      e.preventDefault();
      clearAlert();

      if (!navigator.geolocation) {
        showAlert('Geolocation is not supported by your browser. Please search or pick your location on the map.');
        return;
      }

      const originalBtnHtml = useCurrentLocationBtn.innerHTML;
      useCurrentLocationBtn.disabled = true;
      useCurrentLocationBtn.innerHTML =
        '<span class="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>' +
        '<span>Detecting location...</span>';

      navigator.geolocation.getCurrentPosition(
        async function (position) {
          useCurrentLocationBtn.disabled = false;
          useCurrentLocationBtn.innerHTML = originalBtnHtml;

          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          // Move map & marker to detected coordinates
          map.flyTo({ center: [lng, lat], zoom: 16 });
          marker.setLngLat([lng, lat]);

          // Reverse geocode: Mapbox expects longitude then latitude!
          const result = await reverseGeocode(lng, lat, true);
          if (result && result.placeName && searchInput) {
            searchInput.value = result.placeName;
            if (searchClearBtn) searchClearBtn.classList.remove('hidden');
          }
        },
        function (err) {
          useCurrentLocationBtn.disabled = false;
          useCurrentLocationBtn.innerHTML = originalBtnHtml;

          let msg = 'Location permission was denied. Please allow location access in your browser or search using the search box.';
          if (err.code === 2) { // POSITION_UNAVAILABLE
            msg = 'Location information is currently unavailable. Please search for the location or pick it on the map.';
          } else if (err.code === 3) { // TIMEOUT
            msg = 'Location detection timed out. Please try again or search for your location.';
          }
          showAlert(msg);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  // Choose on Map button
  if (chooseOnMapBtn) {
    chooseOnMapBtn.addEventListener('click', function (e) {
      e.preventDefault();
      mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      map.resize();

      // Flash border to visually guide user
      mapElement.classList.add('ring-2', 'ring-primary');
      setTimeout(function () {
        mapElement.classList.remove('ring-2', 'ring-primary');
      }, 1200);
    });
  }

  // Change location button in confirmation card
  if (changeLocationBtn) {
    changeLocationBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Ensure map canvas resizes properly once layout stabilizes
  setTimeout(function () {
    map.resize();
  }, 400);
})();
