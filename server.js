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
    // Always use Sydney time (Vercel servers may be in UTC)
    const sydDate = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
    const dateStr = sydDate.replace(/-/g, '');
    const sydTime = now.toLocaleTimeString('en-GB', {
      timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false
    });
    const timeStr = sydTime.replace(':', '');

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
    if (!legs.length) return null;

    // Classify legs: walking (99/100), train (1), metro (2), light rail (4), bus (5)
    const transitLegs = legs.filter(leg => {
      const cls = leg.transportation?.product?.class;
      return cls && cls !== 99 && cls !== 100; // exclude walking
    });

    // Must have at least one rail transit leg (train=1 or metro=2)
    const hasRail = legs.some(leg => {
      const cls = leg.transportation?.product?.class;
      return cls === 1 || cls === 2;
    });
    if (!hasRail) return null;

    // First leg = journey start (departure time, even if walking)
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];

    // First non-walking leg = the one with line & platform info
    const boardingLeg = transitLegs[0] || firstLeg;
    const boardingTransport = boardingLeg.transportation || {};
    const boardingOrigin = boardingLeg.origin || {};
    const boardingOriginProps = boardingOrigin.properties || {};

    // Journey start & end
    const journeyOrigin = firstLeg.origin || {};
    const journeyDest = lastLeg.destination || {};
    const destProps = journeyDest.properties || {};

    // Departure = when you leave the origin station (first leg)
    const depTimeStr = journeyOrigin.departureTimeEstimated || journeyOrigin.departureTimePlanned;
    const arrTimeStr = journeyDest.arrivalTimeEstimated || journeyDest.arrivalTimePlanned;
    const depTime = depTimeStr ? new Date(depTimeStr) : null;
    const arrTime = arrTimeStr ? new Date(arrTimeStr) : null;

    // Delay on the boarding leg
    const plannedDep = boardingOrigin.departureTimePlanned ? new Date(boardingOrigin.departureTimePlanned) : null;
    const actualDep = boardingOrigin.departureTimeEstimated ? new Date(boardingOrigin.departureTimeEstimated) : null;
    const delayMinutes = (actualDep && plannedDep)
      ? Math.round((actualDep - plannedDep) / 60000)
      : 0;

    // Minutes until you need to leave
    const minsUntil = depTime ? Math.round((depTime - now) / 60000) : null;

    // Total journey duration
    const durationMins = (depTime && arrTime) ? Math.round((arrTime - depTime) / 60000) : null;

    // Line info from boarding leg
    const lineName = boardingTransport.disassembledName || '?';
    const lineNumber = boardingTransport.number || '';
    const trainDest = boardingTransport.destination ? boardingTransport.destination.name : '';

    // Platform you board at
    const platform = boardingOriginProps.platformName || boardingOriginProps.stoppingPointPlanned || '?';

    // Where you board (station name, useful if it's not the origin)
    const boardingStation = boardingOrigin.disassembledName || '';

    // Platform at final destination
    const arrivalPlatform = destProps.platformName || destProps.stoppingPointPlanned || '?';

    // Real-time status
    const isRealtime = boardingLeg.realtimeStatus && boardingLeg.realtimeStatus.includes('MONITORED');

    // Interchanges
    const interchanges = journey.interchanges || 0;

    // Count stops (only rail legs: train + metro)
    let totalStops = 0;
    for (const leg of legs) {
      const cls = leg.transportation?.product?.class;
      if (cls === 1 || cls === 2) {
        const seq = leg.stopSequence || [];
        if (seq.length > 1) totalStops += seq.length - 1;
      }
    }

    // Build interchange details
    let interchangeDetails = [];
    if (interchanges > 0) {
      interchangeDetails = transitLegs.slice(1).map(leg => {
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
      boardingStation,
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
