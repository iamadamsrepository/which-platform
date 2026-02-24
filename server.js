const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TFNSW_API_KEY;

const TFNSW_BASE = 'https://api.transport.nsw.gov.au/v1/tp';

// Default stations (Wynyard → Redfern)
const DEFAULT_ORIGIN = '200080';      // Wynyard Station
const DEFAULT_DESTINATION = '201510'; // Redfern Station

app.use(express.static(path.join(__dirname, 'public')));

// ─── Trip Planner endpoint ──────────────────────────────────────────────────
app.get('/api/departures', async (req, res) => {
  try {
    const originId = req.query.origin || DEFAULT_ORIGIN;
    const destId = req.query.destination || DEFAULT_DESTINATION;
    const numTrips = req.query.count || 10;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');

    const params = new URLSearchParams({
      outputFormat: 'rapidJSON',
      coordOutputFormat: 'EPSG:4326',
      depArrMacro: 'dep',
      itdDate: dateStr,
      itdTime: timeStr,
      type_origin: 'stop',
      name_origin: originId,
      type_destination: 'stop',
      name_destination: destId,
      calcNumberOfTrips: numTrips,
      TfNSWTR: 'true',
      version: '10.2.1.42',
      excludedMeans: 'checkbox',
      exclMOT_4: '1',   // exclude light rail
      exclMOT_5: '1',   // exclude bus
      exclMOT_7: '1',   // exclude coach
      exclMOT_9: '1',   // exclude ferry
      exclMOT_11: '1',  // exclude school bus
    });

    const url = `${TFNSW_BASE}/trip?${params}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `apikey ${API_KEY}` }
    });

    if (!response.ok) {
      throw new Error(`TfNSW API returned ${response.status}`);
    }

    const data = await response.json();
    const departures = parseDepartures(data, now);

    res.json({
      updated: now.toISOString(),
      departures
    });
  } catch (err) {
    console.error('Error fetching departures:', err.message);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

// ─── Stop finder endpoint (for future settings page) ───────────────────────
app.get('/api/stops', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query param q' });

    const params = new URLSearchParams({
      outputFormat: 'rapidJSON',
      type_sf: 'any',
      name_sf: query,
      coordOutputFormat: 'EPSG:4326',
      TfNSWSF: 'true',
      version: '10.2.1.42',
    });

    const url = `${TFNSW_BASE}/stop_finder?${params}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `apikey ${API_KEY}` }
    });

    const data = await response.json();
    const stops = (data.locations || [])
      .filter(l => l.type === 'stop')
      .map(l => ({
        id: l.id,
        name: l.name,
        disassembledName: l.disassembledName
      }));

    res.json({ stops });
  } catch (err) {
    console.error('Error searching stops:', err.message);
    res.status(500).json({ error: 'Failed to search stops' });
  }
});

// ─── Parse TfNSW journeys into a clean departure list ──────────────────────
function parseDepartures(data, now) {
  const journeys = data.journeys || [];

  return journeys.map(journey => {
    const legs = journey.legs || [];
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    if (!firstLeg) return null;

    const origin = firstLeg.origin || {};
    const destination = lastLeg.destination || {};
    const transport = firstLeg.transportation || {};
    const originProps = origin.properties || {};
    const destProps = destination.properties || {};

    // Departure time (prefer estimated/real-time, fall back to planned)
    const depTimeStr = origin.departureTimeEstimated || origin.departureTimePlanned;
    const arrTimeStr = destination.arrivalTimeEstimated || destination.arrivalTimePlanned;
    const depTime = depTimeStr ? new Date(depTimeStr) : null;
    const arrTime = arrTimeStr ? new Date(arrTimeStr) : null;

    // Is there a delay?
    const plannedDep = origin.departureTimePlanned ? new Date(origin.departureTimePlanned) : null;
    const delayMinutes = (depTime && plannedDep)
      ? Math.round((depTime - plannedDep) / 60000)
      : 0;

    // Minutes until departure
    const minsUntil = depTime ? Math.round((depTime - now) / 60000) : null;

    // Journey duration in minutes
    const durationMins = (depTime && arrTime) ? Math.round((arrTime - depTime) / 60000) : null;

    // Line info
    const lineName = transport.disassembledName || '?';
    const lineNumber = transport.number || '';
    const trainDest = transport.destination ? transport.destination.name : '';

    // Platform at origin
    const platform = originProps.platformName || originProps.stoppingPointPlanned || '?';

    // Platform at destination
    const arrivalPlatform = destProps.platformName || destProps.stoppingPointPlanned || '?';

    // Real-time status
    const isRealtime = firstLeg.realtimeStatus && firstLeg.realtimeStatus.includes('MONITORED');

    // Interchanges
    const interchanges = journey.interchanges || 0;

    // Count stops (from stopSequence in each leg, minus 1 per leg for origin)
    let totalStops = 0;
    for (const leg of legs) {
      const seq = leg.stopSequence || [];
      if (seq.length > 1) totalStops += seq.length - 1; // exclude origin stop
    }

    // Build interchange details if needed
    let interchangeDetails = [];
    if (interchanges > 0) {
      interchangeDetails = legs.slice(1).map(leg => {
        const t = leg.transportation || {};
        const o = leg.origin || {};
        return {
          line: t.disassembledName || '?',
          station: o.disassembledName || '?',
          platform: (o.properties || {}).platformName || '?'
        };
      }).filter(d => d.line !== '?');
    }

    return {
      line: lineName,
      lineNumber,
      trainDestination: trainDest,
      departureTime: depTimeStr,
      arrivalTime: arrTimeStr,
      departureTimeLocal: depTime ? depTime.toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Australia/Sydney'
      }) : '?',
      arrivalTimeLocal: arrTime ? arrTime.toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Australia/Sydney'
      }) : '?',
      minutesUntilDeparture: minsUntil,
      durationMinutes: durationMins,
      platform,
      arrivalPlatform,
      delayMinutes,
      isRealtime,
      interchanges,
      interchangeDetails,
      numberOfStops: totalStops,
      catchable: minsUntil !== null && minsUntil > 5,
    };
  }).filter(Boolean).sort((a, b) => {
    const aTime = new Date(a.departureTime);
    const bTime = new Date(b.departureTime);
    return aTime - bTime;
  });
}

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚉 Which Platform? running at http://localhost:${PORT}`);
  });
}

module.exports = app;
