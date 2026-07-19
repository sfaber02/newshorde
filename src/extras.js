// Absurdist headline data for the top of the feed:
//   1. Is Iggy Pop alive? (checked for real against Wikidata)
//   2. What's the weather vibe, phrased like a friend, not a meteorologist.
//   3. The price of ketchup, to an absurd number of decimal places, with a graph.
import { fetchJson, fetchText } from './sources/http.js';

// ---- weather vibe -----------------------------------------------------------
// Turn a real NWS forecast into a single dumb human headline.
export function weatherHeadline(forecast) {
  const day =
    (forecast.daily || []).find((d) => d.isDaytime) ||
    forecast.daily?.[0] ||
    forecast.current;
  if (!day) return null;

  const short = (day.short || '').toLowerCase();
  const temp = day.temp;
  const precip = day.precip || 0;

  // Phrases are written to read naturally with " in <City>" tacked on the end.
  let mood, text;
  if (/thunder/.test(short)) {
    mood = 'storm';
    text = "it's gonna storm like hell";
  } else if (/(snow|flurr|sleet|blizzard|wintry|ice)/.test(short)) {
    mood = 'snow';
    text = "it's gonna snow";
  } else if (/(rain|shower|drizzle)/.test(short) || precip >= 55) {
    mood = 'rain';
    text = "it's gonna piss rain";
  } else if (temp >= 90) {
    mood = 'hot';
    text = "it'll be hot as shit";
  } else if (temp <= 32) {
    mood = 'cold';
    text = "it's gonna be cold as balls";
  } else if (temp >= 60 && temp <= 85 && /(sun|clear|fair|nice)/.test(short)) {
    mood = 'nice';
    text = "it's gonna be nice out";
  } else if (temp <= 50) {
    mood = 'chilly';
    text = "it's gonna be kinda chilly";
  } else if (/(cloud|overcast)/.test(short)) {
    mood = 'meh';
    text = "it'll be gray and forgettable";
  } else {
    mood = 'meh';
    text = "it'll be whatever out";
  }
  return { text, mood, temp, location: forecast.location || null };
}

// ---- the price of ketchup (real data) ---------------------------------------
// U.S. Bureau of Labor Statistics Producer Price Index, commodity series
// WPU02440127: "Canned Catsup and Other Tomato Based Sauces", pulled from FRED's
// keyless CSV endpoint. It's a monthly index (1982=100), not a shelf price — so
// the move is real, month-over-month, and hilariously tiny. Cached ~12h.
const KETCHUP_SERIES = 'WPU02440127';
const KETCHUP_CSV = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${KETCHUP_SERIES}`;
let ketchupCache = null;
const KETCHUP_TTL = 12 * 60 * 60 * 1000;

export async function ketchupData() {
  if (ketchupCache && Date.now() - ketchupCache.at < KETCHUP_TTL) return ketchupCache.data;

  let data = null;
  try {
    const csv = await fetchText(KETCHUP_CSV, { headers: { 'User-Agent': 'NewsHorde/1.0' } });
    const rows = csv
      .trim()
      .split('\n')
      .slice(1) // header
      .map((line) => line.split(','))
      .filter(([date, val]) => date && val && val !== '.')
      .map(([date, val]) => ({ date, value: Number(val) }))
      .filter((r) => isFinite(r.value));

    if (rows.length >= 2) {
      const latest = rows[rows.length - 1];
      const prev = rows[rows.length - 2];
      const changePct = ((latest.value - prev.value) / prev.value) * 100;
      // Last ~15 months for the sparkline.
      const series = rows.slice(-15).map((r) => ({ date: r.date, price: r.value }));
      data = {
        index: Number(latest.value.toFixed(3)),
        asOf: latest.date,
        changePct: Number(changePct.toFixed(4)), // real, and absurdly tiny
        direction: changePct >= 0 ? 'up' : 'down',
        series,
        source: 'U.S. BLS Producer Price Index · canned catsup & tomato sauces',
      };
    }
  } catch {
    data = null;
  }

  ketchupCache = { at: Date.now(), data };
  return data;
}

// ---- is Iggy Pop alive? -----------------------------------------------------
// James Newell Osterberg Jr. is Wikidata entity Q184572. Property P570 is
// "date of death"; if it ever shows up there, the man is gone. Cached hard.
const IGGY_QID = 'Q184572';
let iggyCache = null;
const IGGY_TTL = 6 * 60 * 60 * 1000; // 6h

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function iggyStatus() {
  if (iggyCache && Date.now() - iggyCache.at < IGGY_TTL) return iggyCache.data;

  let alive = true;
  let diedOn = null;
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${IGGY_QID}&property=P570&format=json&origin=*`;
    const res = await fetchJson(url, { headers: { 'User-Agent': 'NewsHorde/1.0 (is-iggy-alive)' } });
    const claims = res?.claims?.P570 || [];
    if (claims.length) {
      alive = false;
      const t = claims[0]?.mainsnak?.datavalue?.value?.time; // e.g. +2029-04-21T00:00:00Z
      if (t) diedOn = fmtDate(new Date(t.replace(/^\+/, '')));
    }
  } catch {
    alive = true; // assume the best; he's earned it
  }

  const data = alive
    ? { alive: true, sentence: `Iggy Pop is alive and well on ${fmtDate(new Date())}.` }
    : { alive: false, sentence: diedOn ? `Iggy Pop died ${diedOn}. Rest in peace.` : 'Iggy Pop is gone. Rest in peace.' };

  iggyCache = { at: Date.now(), data };
  return data;
}

// ---- has nuclear war broken out? --------------------------------------------
// Nuclear detonations register on seismographs and land in the USGS catalog
// tagged eventtype "nuclear explosion" (that's how NK's tests show up). So we
// ask USGS if any have popped in the last 30 days. Silence = good news. Cached.
let nukeCache = null;
const NUKE_TTL = 30 * 60 * 1000;

export async function nukeStatus() {
  if (nukeCache && Date.now() - nukeCache.at < NUKE_TTL) return nukeCache.data;

  let event = null;
  try {
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventtype=nuclear%20explosion&starttime=${start}&limit=5`;
    const j = await fetchJson(url, { headers: { 'User-Agent': 'NewsHorde/1.0 (nuke-watch)' } });
    const feats = (j.features || []).sort((a, b) => b.properties.time - a.properties.time);
    if (feats.length) event = feats[0].properties;
  } catch {
    event = null; // no news is good news
  }

  const data = event
    ? {
        clear: false,
        sentence: `💣 a nuke just went off near ${event.place} (M${event.mag}). godspeed 👎`,
        place: event.place,
        when: fmtDate(new Date(event.time)),
      }
    : { clear: true, sentence: 'no nukes went off today ☮️' };

  nukeCache = { at: Date.now(), data };
  return data;
}
