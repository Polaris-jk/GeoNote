// Rock units from the DMR 1:250,000 geological map (© กรมทรัพยากรธรณี, CC BY).
//
// The whole country is split into six regions (js/regions.js). Isan ships with the app
// (data/geol/isan.geojson) and works offline from the first launch. The other regions are
// downloaded from this website when the user asks, and kept on the phone (IndexedDB).

/* global L */
import * as db from './db.js';
import { REGIONS, manifest } from './regions.js';
import { t } from './i18n.js';

export const attribution = () => t('หน่วยหิน 1:250,000 © กรมทรัพยากรธรณี', 'Rock units 1:250,000 © Department of Mineral Resources');
const BUNDLED = 'isan';
const kvKey = (id) => `geol-region-${id}`;
const FALLBACK = '#B8B0A0';

let loading = null;
let units = [];       // { f: feature, box: [minX, minY, maxX, maxY] }
let colors = {};      // TEXT_SYM → '#RRGGBB'
let seen = new Set(); // OBJECTIDs already loaded
let loaded = new Set(); // region ids in memory

function bbox(geom) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }
  return [a, b, c, d];
}

function addFeatures(list) {
  let n = 0;
  for (const f of list || []) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const id = f.properties?.OBJECTID ?? f.id;
    if (id != null) { if (seen.has(id)) continue; seen.add(id); }
    units.push({ f, box: bbox(g) });
    n++;
  }
  return n;
}

// DMR legend keys look like "250K-0230-JKpw"; the polygons carry only TEXT_SYM ("JKpw").
function normColors(raw) {
  const out = { 'Water body': '#9CC8F0' };
  for (const [k, v] of Object.entries(raw || {})) {
    out[k] = v;
    const m = /^250K-\d+-(.+)$/.exec(k);
    if (m) out[m[1].trim()] = v;
  }
  return out;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 404 ? t('ยังไม่มีไฟล์นี้บนเว็บ', 'This file is not on the website yet') : `HTTP ${r.status}`);
  return r.json();
}

/** Load the colours, the bundled Isan units and every region kept on the phone. Safe to call often. */
export function load() {
  if (loading) return loading;
  loading = (async () => {
    try { colors = normColors(await fetchJSON('data/rock_colors.json')); } catch { colors = normColors({}); }
    try { addFeatures((await fetchJSON(`data/geol/${BUNDLED}.geojson`)).features); loaded.add(BUNDLED); } catch { /* not bundled */ }
    for (const r of REGIONS) {
      if (r.id === BUNDLED) continue;
      try {
        const feats = await db.get('kv', kvKey(r.id));
        if (feats) { addFeatures(feats); loaded.add(r.id); }
      } catch { /* none */ }
    }
    return units.length;
  })();
  return loading;
}

/** Is this region's rock-unit data on the phone? */
export async function hasRegion(id) {
  await load();
  return loaded.has(id);
}
export const isBundled = (id) => id === BUNDLED;

/** Download one region's rock units from this website and keep them. */
export async function downloadRegion(id) {
  await load();
  const m = await manifest();
  const file = m.geol[id]?.file || `data/geol/${id}.geojson`;
  const gj = await fetchJSON(file);
  const feats = gj.features || [];
  await db.put('kv', feats, kvKey(id));
  const added = addFeatures(feats);
  loaded.add(id);
  return { total: feats.length, added };
}

/** Forget one downloaded region (the bundled Isan data cannot be removed). */
export async function removeRegion(id) {
  if (id === BUNDLED) return;
  await db.del('kv', kvKey(id));
  loading = null; units = []; seen = new Set(); loaded = new Set();
  await load();
}

export const hasData = () => units.length > 0;
export const sym = (f) => String(f?.properties?.TEXT_SYM ?? '').trim();
export const colorOf = (f) => colors[sym(f)] || FALLBACK;

// The DMR 250K layer carries only the map symbol. Names of the common Isan formations:
const FORMATIONS = {
  Qa: ['ตะกอนน้ำพา (Alluvium)', 'Alluvium'], Qt: ['ตะกอนตะพักลำน้ำ (Terrace)', 'Terrace deposits'],
  Qbs: ['หินบะซอลต์', 'Basalt'], Tbs: ['หินบะซอลต์', 'Basalt'],
  KTms: ['หมวดหินมหาสารคาม', 'Maha Sarakham Formation'], KTpt: ['หมวดหินภูทอก', 'Phu Tok Formation'],
  Kkk: ['หมวดหินโคกกรวด', 'Khok Kruat Formation'], Kpp: ['หมวดหินภูพาน', 'Phu Phan Formation'],
  Ksk: ['หมวดหินเสาขัว', 'Sao Khua Formation'], JKpw: ['หมวดหินพระวิหาร', 'Phra Wihan Formation'],
  Jpk: ['หมวดหินภูกระดึง', 'Phu Kradung Formation'], Trnp: ['หมวดหินน้ำพอง', 'Nam Phong Formation'],
  'Water body': ['แหล่งน้ำ', 'Water body'],
};
// age from the leading period letters of the symbol (e.g. KTms → Cretaceous–Tertiary)
const PERIODS = [['PE', 'Precambrian'], ['Tr', 'Triassic'], ['Q', 'Quaternary'], ['T', 'Tertiary'], ['K', 'Cretaceous'],
  ['J', 'Jurassic'], ['P', 'Permian'], ['C', 'Carboniferous'], ['D', 'Devonian'], ['S', 'Silurian'], ['O', 'Ordovician'], ['E', 'Cambrian']];
function ageOf(code) {
  const out = [];
  let rest = code;
  for (let i = 0; i < 3 && rest; i++) {
    const hit = PERIODS.find(([k]) => rest.startsWith(k));
    if (!hit) break;
    out.push(hit[1]);
    rest = rest.slice(hit[0].length);
    if (rest && rest[0] === rest[0].toLowerCase()) break; // the formation letters start
  }
  return out.join('–');
}

/** Readable name/age of a unit, from whichever descriptive fields the DMR layer carries. */
export function describe(f) {
  const p = f?.properties || {};
  const pick = (re) => {
    const k = Object.keys(p).find((key) => re.test(key) && p[key] != null && String(p[key]).trim());
    return k ? String(p[k]).trim() : '';
  };
  const code = sym(f);
  return {
    sym: code,
    name: FORMATIONS[code] ? t(...FORMATIONS[code]) : pick(/^(FORM|FM|ROCK_?UNIT|UNIT|NAME)(_?T(H)?)?$|FORMATION/i),
    age: pick(/AGE|PERIOD|ERA/i) || (code === 'Water body' ? '' : ageOf(code)),
    rock: pick(/LITH|ROCK_?(TYPE|DES)|DESC/i),
  };
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(x, y, rings) {
  if (!inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
  return true;
}

/** The rock unit under a point, or null when there is no data there. */
export function unitAt(lat, lon) {
  for (const u of units) {
    const [a, b, c, d] = u.box;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    const g = u.f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((rings) => inPolygon(lon, lat, rings))) return u.f;
  }
  return null;
}

/** A Leaflet layer of the units that touch `bounds` (drawn on canvas, so thousands stay smooth). */
export function layer(bounds) {
  const [w, s, e, n] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const feats = units.filter(({ box }) => !(box[2] < w || box[0] > e || box[3] < s || box[1] > n)).map((u) => u.f);
  return L.geoJSON({ type: 'FeatureCollection', features: feats }, {
    renderer: L.canvas({ padding: 0.3 }),
    interactive: false,
    style: (f) => ({ color: '#222', weight: 0.6, opacity: 0.55, fillColor: colorOf(f), fillOpacity: 0.42 }),
    attribution: attribution(),
  });
}
