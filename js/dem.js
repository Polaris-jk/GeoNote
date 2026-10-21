// Ground heights (DEM) for the cross section.
//
// Elevation tiles are Terrarium-encoded images: height (m) = R × 256 + G + B / 256 − 32768.
//   1. Mapterhorn (mapterhorn.com): Copernicus DEM GLO-30 (30 m) over Thailand, 512 px WebP, zoom 12
//   2. Terrain Tiles on AWS (Mapzen/Tilezen): SRTM 30 m, 256 px PNG, zoom 13 (used when 1 cannot be reached)
// Both work out at about 18 m per pixel in Thailand. Both are surface models (DSM): on forested hills
// the ground line sits a few metres above the soil.
// Every tile fetched is kept on the phone (IndexedDB), so an area seen once works with no internet;
// an area can also be downloaded ahead from the map button on the GPS and Map screens.

import * as db from './db.js';
import { t } from './i18n.js';

export const SOURCES = [
  {
    id: 'mth', z: 12, size: 512, type: 'image/webp',
    url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
    name: 'Copernicus DEM 30 m · Mapterhorn',
    credit: 'Mapterhorn · Copernicus DEM GLO-30 © DLR e.V. 2010–2014, © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA',
  },
  {
    id: 'aws', z: 13, size: 256, type: 'image/png',
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    name: 'SRTM 30 m · Terrain Tiles (AWS)',
    credit: 'Terrain Tiles (Mapzen, AWS Open Data) · SRTM data courtesy of the U.S. Geological Survey',
  },
];
export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

const MAX_PATH_TILES = 300;   // tiles one cross section may need
export const MAX_AREA_TILES = 120; // tiles one area download may take (about 100 × 100 km)
const kvKey = (src, k) => `dem:${src.id}:${src.z}/${k}`;
const INDEX_KEY = 'dem-index';

// ---------- tile maths (Web Mercator) ----------

/** Global pixel position of a point at the source's zoom (pixel centres at +0.5). */
function globalPx(lat, lon, src) {
  const n = 2 ** src.z * src.size;
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n];
}

/** Keys "x/y" of the tiles needed to read heights at these points (with their bilinear neighbours). */
function tilesForPoints(points, src) {
  const keys = new Set();
  const T = src.size;
  for (const p of points) {
    const [gx, gy] = globalPx(p.lat, p.lon, src);
    const i0 = Math.floor(gx - 0.5), j0 = Math.floor(gy - 0.5);
    for (const i of [i0, i0 + 1]) for (const j of [j0, j0 + 1]) keys.add(`${Math.floor(i / T)}/${Math.floor(j / T)}`);
  }
  return [...keys];
}

/** Keys of every tile covering a lat/lon box. */
function tilesForBounds({ south, west, north, east }, src) {
  const T = src.size;
  const [x0, y0] = globalPx(north, west, src);
  const [x1, y1] = globalPx(south, east, src);
  const out = [];
  for (let x = Math.floor(x0 / T); x <= Math.floor(x1 / T); x++) {
    for (let y = Math.floor(y0 / T); y <= Math.floor(y1 / T); y++) out.push(`${x}/${y}`);
  }
  return out;
}

// ---------- storage ----------

let index = null; // { key: bytes }
async function loadIndex() {
  if (!index) {
    try { index = (await db.get('kv', INDEX_KEY)) || {}; } catch { index = {}; }
  }
  return index;
}
let indexTimer = null;
function saveIndexSoon() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => { db.put('kv', { ...index }, INDEX_KEY).catch(() => {}); }, 400);
}

async function readStored(src, k) {
  try { return (await db.get('kv', kvKey(src, k))) || null; } catch { return null; }
}
async function store(src, k, rec) {
  await db.put('kv', rec, kvKey(src, k));
  await loadIndex();
  index[kvKey(src, k)] = rec.empty ? 0 : rec.buf.byteLength;
  saveIndexSoon();
}

/** Tiles kept on the phone: { count, bytes }. */
export async function storedInfo() {
  const ix = await loadIndex();
  const vals = Object.values(ix);
  return { count: vals.length, bytes: vals.reduce((a, b) => a + (b || 0), 0) };
}

/** Delete every DEM tile from the phone. */
export async function clear() {
  const ix = await loadIndex();
  for (const key of Object.keys(ix)) { try { await db.del('kv', key); } catch { /* gone */ } }
  index = {};
  clearTimeout(indexTimer);
  await db.put('kv', {}, INDEX_KEY);
  memory.clear();
}

// ---------- network ----------

async function fetchTile(src, k) {
  const [x, y] = k.split('/').map(Number);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(src.url(src.z, x, y), { mode: 'cors', signal: ctl.signal });
    // no tile = open sea (the DEM has no data there): height 0
    if (r.status === 404) return { empty: true };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) throw new Error(t('ไฟล์ว่าง', 'empty file'));
    return { buf, type: r.headers.get('content-type') || src.type };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- decoding ----------

const memory = new Map(); // kvKey → decoded tile, most recent last
const MEMORY_MAX = 24;
function remember(key, d) {
  memory.delete(key);
  memory.set(key, d);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

function loadImg(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(t('อ่านไฟล์ความสูงไม่ได้', 'Cannot read the height tile'))); };
    img.src = url;
  });
}

async function decode(rec, src) {
  if (rec.empty) return { empty: true };
  const blob = new Blob([rec.buf], { type: rec.type || src.type });
  let img;
  try {
    img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    img = await loadImg(blob);
  }
  const w = img.width, h = img.height;
  if (w !== src.size || h !== src.size) throw new Error(t('ขนาดไฟล์ความสูงไม่ตรง', 'Unexpected height tile size'));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  img.close?.();
  const px = ctx.getImageData(0, 0, w, h).data;
  const e = new Float32Array(w * h);
  for (let i = 0, j = 0; i < e.length; i++, j += 4) e[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
  return { w, h, e };
}

async function decodedTile(src, k, rec) {
  const key = kvKey(src, k);
  if (memory.has(key)) { const d = memory.get(key); remember(key, d); return d; }
  const d = await decode(rec, src);
  remember(key, d);
  return d;
}

function makeSampler(src, tiles) {
  const T = src.size;
  const val = (i, j) => {
    const tx = Math.floor(i / T), ty = Math.floor(j / T);
    const d = tiles.get(`${tx}/${ty}`);
    if (!d) return NaN;
    if (d.empty) return 0;
    return d.e[(j - ty * T) * T + (i - tx * T)];
  };
  return (lat, lon) => {
    const [gx, gy] = globalPx(lat, lon, src);
    const fx = gx - 0.5, fy = gy - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const wx = fx - i0, wy = fy - j0;
    const a = val(i0, j0), b = val(i0 + 1, j0), c = val(i0, j0 + 1), d = val(i0 + 1, j0 + 1);
    return (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
  };
}

/** Run jobs a few at a time. */
async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

/**
 * Get ready to read heights at these points ({ lat, lon }). Uses tiles on the phone first, then
 * the network. Resolves { ok: true, source, sample(lat, lon) } or { ok: false, reason }:
 * 'offline' (tiles missing and no internet), 'error' (the DEM servers could not be reached), 'far'.
 */
export async function prepare(points, { onProgress } = {}) {
  const online = navigator.onLine !== false;
  let reason = online ? 'error' : 'offline';
  for (const src of SOURCES) {
    const keys = tilesForPoints(points, src);
    if (keys.length > MAX_PATH_TILES) return { ok: false, reason: 'far' };
    const tiles = new Map(); // decoded tiles held for this cross section
    const recs = new Map();  // stored or downloaded, not decoded yet
    for (const k of keys) {
      const key = kvKey(src, k);
      if (memory.has(key)) { tiles.set(k, memory.get(key)); continue; }
      const r = await readStored(src, k);
      if (r) recs.set(k, r);
    }
    const missing = keys.filter((k) => !tiles.has(k) && !recs.has(k));
    if (missing.length && !online) continue;
    let failed = false;
    let done = 0;
    if (missing.length) {
      await pool(missing, 4, async (k) => {
        if (failed) return;
        try {
          const r = await fetchTile(src, k);
          recs.set(k, r);
          await store(src, k, r).catch(() => {});
        } catch {
          failed = true;
        }
        onProgress?.(++done, missing.length);
      });
    }
    if (failed) continue;
    try {
      for (const [k, r] of recs) tiles.set(k, await decodedTile(src, k, r));
      return { ok: true, source: src, sample: makeSampler(src, tiles) };
    } catch {
      reason = 'error';
    }
  }
  return { ok: false, reason };
}

/** How many tiles an area download would take (with the first source). */
export const tileCount = (bounds) => tilesForBounds(bounds, SOURCES[0]).length;

/**
 * Download the heights of a lat/lon box ({ south, west, north, east }) to keep on the phone.
 * Resolves { source, count, bytes }; throws when nothing could be downloaded.
 */
export async function downloadArea(bounds, onProgress) {
  let lastErr = null;
  for (const src of SOURCES) {
    const keys = tilesForBounds(bounds, src);
    if (keys.length > MAX_AREA_TILES * (src.size === 256 ? 4 : 1)) throw new Error(t('พื้นที่กว้างเกินไป', 'The area is too large'));
    let bytes = 0, done = 0, got = 0, fails = 0;
    await pool(keys, 4, async (k) => {
      const have = await readStored(src, k);
      if (have) { got++; bytes += have.empty ? 0 : have.buf.byteLength; onProgress?.(++done, keys.length, bytes); return; }
      if (fails >= 3 && !got) { fails++; return; } // this source does not answer: try the next one
      try {
        const r = await fetchTile(src, k);
        await store(src, k, r);
        got++;
        bytes += r.empty ? 0 : r.buf.byteLength;
      } catch (err) {
        fails++;
        lastErr = err;
      }
      onProgress?.(++done, keys.length, bytes);
    });
    if (!fails) return { source: src, count: keys.length, bytes };
    if (got >= keys.length / 2) return { source: src, count: got, bytes, partial: true };
  }
  throw lastErr || new Error(t('ดาวน์โหลดไม่สำเร็จ', 'Download failed'));
}
