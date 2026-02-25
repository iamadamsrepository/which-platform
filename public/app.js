// ─── Config ─────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 30_000; // 30 seconds
const UPDATE_TICKER = 5_000;     // update "x ago" every 5s
const COUNTDOWN_TICKER = 15_000; // re-render countdown every 15s

// ─── Defaults ───────────────────────────────────────────────────────────────
const DEFAULTS = {
  originId: '200080',
  originName: 'Wynyard',
  destId: '201510',
  destName: 'Redfern',
};

// ─── State ──────────────────────────────────────────────────────────────────
let refreshTimer = null;
let departures = [];
let lastFetchTime = null;
let settings = loadSettings();

// ─── DOM refs ───────────────────────────────────────────────────────────────
const $loading = document.getElementById('loading');
const $error = document.getElementById('error');
const $departures = document.getElementById('departures');
const $lastUpdate = document.getElementById('lastUpdate');
const $refreshBtn = document.getElementById('refreshBtn');
const $originName = document.getElementById('originName');
const $destName = document.getElementById('destName');

// Header swap button
const $swapBtn = document.getElementById('swapBtn');

// Settings panel
const $settingsBtn = document.getElementById('settingsBtn');
const $settingsPanel = document.getElementById('settingsPanel');
const $settingsClose = document.getElementById('settingsClose');
const $homeStation = document.getElementById('homeStation');
const $homeResults = document.getElementById('homeResults');
const $homeStationId = document.getElementById('homeStationId');
const $homeStationLabel = document.getElementById('homeStationLabel');
const $workStation = document.getElementById('workStation');
const $workResults = document.getElementById('workResults');
const $workStationId = document.getElementById('workStationId');
const $workStationLabel = document.getElementById('workStationLabel');
const $sourceStation = document.getElementById('sourceStation');
const $sourceResults = document.getElementById('sourceResults');
const $sourceStationId = document.getElementById('sourceStationId');
const $sourceStationLabel = document.getElementById('sourceStationLabel');
const $destStation = document.getElementById('destStation');
const $destResults = document.getElementById('destResults');
const $destStationId = document.getElementById('destStationId');
const $destStationLabel = document.getElementById('destStationLabel');
const $btnHomeToWork = document.getElementById('btnHomeToWork');
const $btnWorkToHome = document.getElementById('btnWorkToHome');
const $btnSwap = document.getElementById('btnSwap');

// Home/Work edit toggle elements
const $homeSavedRow = document.getElementById('homeSavedRow');
const $homeEditRow = document.getElementById('homeEditRow');
const $homeEditBtn = document.getElementById('homeEditBtn');
const $homeCancelBtn = document.getElementById('homeCancelBtn');
const $workSavedRow = document.getElementById('workSavedRow');
const $workEditRow = document.getElementById('workEditRow');
const $workEditBtn = document.getElementById('workEditBtn');
const $workCancelBtn = document.getElementById('workCancelBtn');

// ─── Settings persistence ───────────────────────────────────────────────────
function loadSettings() {
  try {
    const stored = localStorage.getItem('whichplatform_settings');
    if (stored) {
      return { ...DEFAULTS, ...JSON.parse(stored) };
    }
  } catch (e) {}
  return { ...DEFAULTS };
}

function saveSettings() {
  localStorage.setItem('whichplatform_settings', JSON.stringify(settings));
}

// ─── Apply settings to UI ───────────────────────────────────────────────────
function applySettings() {
  $originName.textContent = settings.originName;
  $destName.textContent = settings.destName;

  // Show saved home/work in labels
  if (settings.homeName) {
    $homeStationLabel.textContent = settings.homeName;
    $homeStationLabel.classList.remove('not-set');
  } else {
    $homeStationLabel.textContent = 'Not set';
    $homeStationLabel.classList.add('not-set');
  }
  if (settings.workName) {
    $workStationLabel.textContent = settings.workName;
    $workStationLabel.classList.remove('not-set');
  } else {
    $workStationLabel.textContent = 'Not set';
    $workStationLabel.classList.add('not-set');
  }

  // Reset edit rows to saved view
  $homeSavedRow.style.display = 'flex';
  $homeEditRow.style.display = 'none';
  $homeStation.value = '';
  $workSavedRow.style.display = 'flex';
  $workEditRow.style.display = 'none';
  $workStation.value = '';

  // Show current source/dest in labels
  $sourceStationLabel.textContent = settings.originName || '';
  $destStationLabel.textContent = settings.destName || '';
  $sourceStation.value = '';
  $destStation.value = '';

  // Enable/disable quick action buttons
  const hasHome = settings.homeId && settings.homeName;
  const hasWork = settings.workId && settings.workName;
  $btnHomeToWork.disabled = !(hasHome && hasWork);
  $btnWorkToHome.disabled = !(hasHome && hasWork);
}

// ─── Fetch departures from our backend ──────────────────────────────────────
async function fetchDepartures() {
  try {
    $refreshBtn.classList.add('spinning');
    $error.style.display = 'none';

    const params = new URLSearchParams({
      origin: settings.originId,
      destination: settings.destId,
    });
    const res = await fetch(`/api/departures?${params}`);
    if (!res.ok) throw new Error('API error');

    const data = await res.json();
    departures = data.departures || [];
    lastFetchTime = new Date();

    renderDepartures();
    updateTimeAgo();

    $loading.style.display = 'none';
  } catch (err) {
    console.error('Failed to fetch:', err);
    $loading.style.display = 'none';
    if (departures.length === 0) {
      $error.style.display = 'block';
    }
  } finally {
    $refreshBtn.classList.remove('spinning');
  }
}

// ─── "x ago" updater ────────────────────────────────────────────────────────
function updateTimeAgo() {
  if (!lastFetchTime) return;
  const now = new Date();
  const diffSec = Math.round((now - lastFetchTime) / 1000);

  if (diffSec < 5) {
    $lastUpdate.textContent = 'Updated just now';
  } else if (diffSec < 60) {
    $lastUpdate.textContent = `Updated ${diffSec}s ago`;
  } else {
    const mins = Math.floor(diffSec / 60);
    $lastUpdate.textContent = `Updated ${mins}m ago`;
  }
}

// ─── Render the departure board ─────────────────────────────────────────────
function renderDepartures() {
  if (departures.length === 0) {
    $departures.innerHTML = `
      <div class="no-trains">
        <p>No upcoming trains</p>
        <span>Check back later</span>
      </div>`;
    return;
  }

  const now = new Date();

  const updated = departures.map(d => {
    const depTime = new Date(d.departureTime);
    const minsUntil = Math.round((depTime - now) / 60000);
    return {
      ...d,
      minutesUntilDeparture: minsUntil,
    };
  }).filter(d => d.minutesUntilDeparture >= 0);

  if (updated.length === 0) {
    $departures.innerHTML = `
      <div class="no-trains">
        <p>No upcoming trains</p>
        <span>Refreshing soon...</span>
      </div>`;
    return;
  }

  let html = '';

  updated.forEach(dep => {
    const platformNum = dep.platform.replace('Platform ', '');
    const lineClass = getLineClass(dep.line);

    const minsText = dep.minutesUntilDeparture <= 0
      ? 'NOW'
      : dep.minutesUntilDeparture === 1
        ? '1 min'
        : `${dep.minutesUntilDeparture} min`;

    let metaHtml = '';
    if (dep.isRealtime) {
      metaHtml += '<span class="realtime-dot" title="Real-time tracked"></span>';
    }
    if (dep.delayMinutes > 0) {
      metaHtml += `<span class="delay-info">+${dep.delayMinutes}m late</span>`;
    }
    if (dep.boardingStation) {
      metaHtml += `<span class="boarding-badge">board at ${dep.boardingStation.replace(/ Station.*/, '')}</span>`;
    }
    if (dep.interchanges > 0) {
      metaHtml += `<span class="interchange-badge">${dep.interchanges} change</span>`;
    }
    if (dep.numberOfStops) {
      metaHtml += `<span class="stops-badge">${dep.numberOfStops} stop${dep.numberOfStops !== 1 ? 's' : ''}</span>`;
    }
    if (dep.durationMinutes != null) {
      metaHtml += `<span class="duration-badge">${dep.durationMinutes}m</span>`;
    }
    metaHtml += `<span class="arr-time">arr ${dep.arrivalTimeLocal}</span>`;

    html += `
      <div class="departure-card">
        <div class="card-top">
          <div class="time-section">
            <span class="dep-time">${dep.departureTimeLocal}</span>
            <span class="mins-away">${minsText}</span>
          </div>
          <div class="platform-badge">
            <span class="platform-label">Platform</span>
            <span class="platform-number">${platformNum}</span>
          </div>
        </div>
        <div class="card-bottom">
          <div class="line-info">
            <span class="line-badge ${lineClass}">${dep.line}</span>
            <span class="train-dest">${dep.trainDestination}</span>
          </div>
        </div>
        <div class="trip-details">
          ${metaHtml}
        </div>
      </div>`;
  });

  $departures.innerHTML = html;
}

// ─── Line colour class ──────────────────────────────────────────────────────
function getLineClass(line) {
  const trainMatch = line.match(/T\d+/);
  if (trainMatch) return `line-${trainMatch[0]}`;
  const metroMatch = line.match(/M\d+/);
  if (metroMatch) return `line-${metroMatch[0]}`;
  const lrMatch = line.match(/L\d+/);
  if (lrMatch) return `line-${lrMatch[0]}`;
  return 'line-default';
}

// ─── Station search (debounced) ─────────────────────────────────────────────
let searchTimeout = null;

function setupStationSearch(inputEl, resultsEl, hiddenEl, labelEl, settingKey, isRoute = false) {
  inputEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = inputEl.value.trim();
    if (query.length < 2) {
      resultsEl.classList.remove('active');
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stops?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const stops = data.stops || [];

        if (stops.length === 0) {
          resultsEl.innerHTML = '<div class="search-result-item">No stations found</div>';
        } else {
          resultsEl.innerHTML = stops.map(s =>
            `<div class="search-result-item" data-id="${s.id}" data-name="${s.disassembledName}">${s.disassembledName}</div>`
          ).join('');
        }
        resultsEl.classList.add('active');

        // Click handlers for results
        resultsEl.querySelectorAll('[data-id]').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.dataset.id;
            const name = el.dataset.name;
            hiddenEl.value = id;
            labelEl.textContent = name;
            inputEl.value = '';
            resultsEl.classList.remove('active');

            if (isRoute) {
              // Map 'origin'/'dest' keys to actual settings keys
              const idKey = settingKey === 'origin' ? 'originId' : 'destId';
              const nameKey = settingKey === 'origin' ? 'originName' : 'destName';
              settings[idKey] = id;
              settings[nameKey] = name;
            } else {
              settings[settingKey + 'Id'] = id;
              settings[settingKey + 'Name'] = name;
            }
            saveSettings();
            applySettings();
            if (isRoute) {
              // Refresh departures when route changes
              departures = [];
              $loading.style.display = 'flex';
              $settingsPanel.style.display = 'none';
              fetchDepartures();
              resetRefreshTimer();
            }
          });
        });
      } catch (e) {
        console.error('Search error:', e);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.classList.remove('active');
    }
  });
}

// ─── Settings panel ─────────────────────────────────────────────────────────
$settingsBtn.addEventListener('click', () => {
  applySettings();
  $settingsPanel.style.display = 'block';
});

$settingsClose.addEventListener('click', () => {
  $settingsPanel.style.display = 'none';
});

setupStationSearch($homeStation, $homeResults, $homeStationId, $homeStationLabel, 'home');
setupStationSearch($workStation, $workResults, $workStationId, $workStationLabel, 'work');
setupStationSearch($sourceStation, $sourceResults, $sourceStationId, $sourceStationLabel, 'origin', true);
setupStationSearch($destStation, $destResults, $destStationId, $destStationLabel, 'dest', true);

// Home edit/cancel
$homeEditBtn.addEventListener('click', () => {
  $homeSavedRow.style.display = 'none';
  $homeEditRow.style.display = 'flex';
  $homeStation.focus();
});
$homeCancelBtn.addEventListener('click', () => {
  $homeSavedRow.style.display = 'flex';
  $homeEditRow.style.display = 'none';
  $homeStation.value = '';
  $homeResults.classList.remove('active');
});

// Work edit/cancel
$workEditBtn.addEventListener('click', () => {
  $workSavedRow.style.display = 'none';
  $workEditRow.style.display = 'flex';
  $workStation.focus();
});
$workCancelBtn.addEventListener('click', () => {
  $workSavedRow.style.display = 'flex';
  $workEditRow.style.display = 'none';
  $workStation.value = '';
  $workResults.classList.remove('active');
});

// Route helper: set origin+dest, close settings, refresh
function setRouteAndRefresh(originId, originName, destId, destName) {
  settings.originId = originId;
  settings.originName = originName;
  settings.destId = destId;
  settings.destName = destName;
  saveSettings();
  applySettings();
  $settingsPanel.style.display = 'none';
  departures = [];
  $loading.style.display = 'flex';
  fetchDepartures();
  resetRefreshTimer();
}

$btnHomeToWork.addEventListener('click', () => {
  if (settings.homeId && settings.workId) {
    setRouteAndRefresh(settings.homeId, settings.homeName, settings.workId, settings.workName);
  }
});

$btnWorkToHome.addEventListener('click', () => {
  if (settings.homeId && settings.workId) {
    setRouteAndRefresh(settings.workId, settings.workName, settings.homeId, settings.homeName);
  }
});

$btnSwap.addEventListener('click', () => {
  swapRoute();
});

// Header swap button
$swapBtn.addEventListener('click', () => {
  swapRoute();
});

function swapRoute() {
  setRouteAndRefresh(settings.destId, settings.destName, settings.originId, settings.originName);
}

// ─── Timers ─────────────────────────────────────────────────────────────────
function resetRefreshTimer() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchDepartures, REFRESH_INTERVAL);
}

$refreshBtn.addEventListener('click', () => {
  fetchDepartures();
  resetRefreshTimer();
});

// ─── Init ───────────────────────────────────────────────────────────────────
applySettings();
fetchDepartures();
refreshTimer = setInterval(fetchDepartures, REFRESH_INTERVAL);

// Countdown ticker
setInterval(() => {
  if (departures.length > 0) renderDepartures();
}, COUNTDOWN_TICKER);

// "Updated x ago" ticker
setInterval(updateTimeAgo, UPDATE_TICKER);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
