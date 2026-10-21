// Cross section along the stations, in the order they were made (ST-001 → ST-002 → …), or along a
// straight line across the mean strike with the stations projected onto it.
//
// Ground line: DEM heights sampled along the line (js/dem.js), or the GPS heights of the stations
// when no DEM can be had.
// Rocks and dips: what was recorded at each station, unless it was changed on the cross section
// screen. Those changes are kept with the cross section (IndexedDB "xsec-<project id>") and never
// touch the notebook, so an odd block that is not in place (float) can be left out or corrected.
// Below ground ("dip domain" construction):
//   • each bedding attitude becomes an apparent dip along the section line:
//       tan(apparent dip) = tan(dip) · cos(dip direction − section azimuth)
//   • apparent dips are interpolated between stations; every bed boundary follows them, so the
//     boundaries never cross (beds keep their vertical spacing);
//   • a point underground takes the rock of the place where its bed comes up to the ground, the
//     nearest such place along the section; contacts sit halfway between two stations with
//     different rocks unless moved;
//   • beds may also come up just past either end (ground and dip carried on), taking the rock at
//     that end; a bed that comes up nowhere takes the lowest rock seen. The dashed line is the
//     lowest bed that comes up on the line itself.
// Everything is computed in metres and only stretched when drawn, so the vertical exaggeration
// steepens drawn dips exactly as tan(drawn) = V.E. · tan(apparent).

import * as db from './db.js';
import { rockKey, UNKNOWN_COLOR, knownColor, pickColor } from './rockcolors.js';
import { LITHOLOGY } from './vocab.js';
import { norm360, strikeToDipDir, dipDirToStrike, cardinal, az3 } from './geomath.js';
import { loadFonts, wrap, SANS, MONO } from './draw.js';
import { pointType, walkEnds, shapeOf, pathShape } from './pointtype.js';
import { t, isEn } from './i18n.js';

const D2R = Math.PI / 180;
const rad = (d) => d * D2R;
const deg = (r) => r / D2R;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export const NICE_VE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20];
const NICE_DEPTH = [10, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
export const DEPTH_CHOICES = [50, 100, 250, 500, 1000];
const PLANE_TYPES = ['Bedding', 'Contact', 'Foliation']; // the first type found at a station is used
const MAX_DIP = 89;
const BEND = 30; // degrees: a sharper turn of the path is marked on the section

const snap = (v, list) => list.reduce((a, b) => (Math.abs(Math.log(b / v)) < Math.abs(Math.log(a / v)) ? b : a));

// ---------- settings of one project's cross section ----------

// line: 'path' — through the stations in order; 'strike' — a straight line across the strike of
// the beds, with every station projected onto it
export const defaultConfig = () => ({ v: 1, line: 'path', ve: 'auto', depth: 'auto', under: true, flip: false, zoom: 1, over: {}, contacts: {}, colors: {}, autoColors: {} });
const kvKey = (projectId) => `xsec-${projectId}`;

export async function loadConfig(projectId) {
  let saved = null;
  try { saved = await db.get('kv', kvKey(projectId)); } catch { /* none */ }
  const c = { ...defaultConfig(), ...(saved || {}) };
  for (const k of ['over', 'contacts', 'colors', 'autoColors']) c[k] = { ...(c[k] || {}) };
  return c;
}
export const saveConfig = (projectId, cfg) => db.put('kv', JSON.parse(JSON.stringify(cfg)), kvKey(projectId));
export const deleteConfig = (projectId) => db.del('kv', kvKey(projectId));

// ---------- rocks ----------

/** Rocks that are the same on the section share one key ("Siltstone, laminated" → Siltstone). */
export function rockGroup(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return rockKey(s) || `c:${s.toLowerCase()}`;
}
function rockLabel(key, typed) {
  if (!key.startsWith('c:')) {
    const th = LITHOLOGY.find(([en]) => en === key)?.[1] || '';
    return { name: key, th: isEn() ? '' : th };
  }
  return { name: String(typed || '').trim(), th: '' };
}
/** Default colour of a rock: the app's rock colours (DMR map convention), else one picked for this section. */
export function defaultColor(key, typed, cfg, used = []) {
  const known = knownColor(key.startsWith('c:') ? typed : key);
  if (known) return { color: known, changed: false };
  if (cfg.autoColors[key]) return { color: cfg.autoColors[key], changed: false };
  const color = pickColor(typed || key, used);
  cfg.autoColors[key] = color;
  return { color, changed: true };
}

// ---------- attitudes ----------

const dipDirOf = (m) => (fin(m.dipdir) ? norm360(m.dipdir) : fin(m.strike) ? strikeToDipDir(m.strike) : null);

function meanPlane(list) {
  let x = 0, y = 0, z = 0;
  for (const m of list) {
    const d = rad(clamp(m.dip, 0, 90)), a = rad(dipDirOf(m));
    x += Math.sin(d) * Math.sin(a); y += Math.sin(d) * Math.cos(a); z += Math.cos(d);
  }
  const n = Math.hypot(x, y, z) || 1;
  const dip = deg(Math.acos(clamp(z / n, -1, 1)));
  const dipdir = dip < 0.05 ? dipDirOf(list[0]) : norm360(deg(Math.atan2(x, y)));
  return { dip, dipdir, strike: dipDirToStrike(dipdir), n: list.length };
}

const usable = (m) => m && fin(m.dip) && dipDirOf(m) != null;

/** The bedding (else contact, else foliation) attitude recorded at a station, averaged; or null. */
export function notebookPlane(st) {
  const ms = (st.measurements || []).filter(usable);
  for (const type of PLANE_TYPES) {
    const list = ms.filter((m) => (m.type || 'Bedding') === type);
    if (list.length) return { ...meanPlane(list), type };
  }
  return null;
}
const faultPlanes = (st) => (st.measurements || []).filter((m) => usable(m) && m.type === 'Fault')
  .map((m) => ({ dip: clamp(m.dip, 0, 90), dipdir: dipDirOf(m) }));

export function planeFrom(att) {
  if (!att || !fin(att.dip)) return null;
  const dd = dipDirOf(att);
  return dd == null ? null : { dip: clamp(att.dip, 0, 90), dipdir: dd, strike: dipDirToStrike(dd) };
}

/** Apparent dip (degrees) along a section heading `az`: positive = dips toward the far end. */
export function apparentDip(plane, az) {
  const dip = clamp(plane.dip, 0, MAX_DIP);
  return deg(Math.atan(Math.tan(rad(dip)) * Math.cos(rad(plane.dipdir - az))));
}

export const isEdited = (o) => !!o && (o.rock != null || o.att != null || o.noDip || o.skip || o.offPath);

/** A station as the cross section sees it (changes made on the cross section screen applied). */
export function effective(st, cfg) {
  const o = cfg.over[st.id] || {};
  const nbRock = String(st.lithology || '').trim();
  const nbPlane = notebookPlane(st);
  let plane = o.att ? planeFrom(o.att) : nbPlane;
  if (o.noDip) plane = null;
  return {
    rock: o.rock != null ? String(o.rock).trim() : nbRock,
    plane,
    faults: faultPlanes(st),
    skip: !!o.skip,
    offPath: !!o.offPath,
    edited: isEdited(o),
    nbRock,
    nbPlane,
  };
}

// ---------- path along the stations ----------

const angleDiff = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)) % 360; return d > 180 ? 360 - d : d; };

/** The section line: through the stations in order (or reversed), or straight across the strike. */
export function makePath(stations, cfg) {
  const located = stations
    .filter((s) => s.location && fin(s.location.lat) && fin(s.location.lon))
    .sort((a, b) => (a.number || 0) - (b.number || 0));
  const noCoord = stations.length - located.length;
  const off = located.filter((s) => cfg.over[s.id]?.offPath);
  const on = located.filter((s) => !cfg.over[s.id]?.offPath);
  const straight = cfg.line === 'strike';
  if (cfg.flip && !straight) on.reverse();
  if (on.length < 2) return { ok: false, reason: 'few', noCoord, off, located };
  const lat0 = on.reduce((a, s) => a + s.location.lat, 0) / on.length;
  const lon0 = on.reduce((a, s) => a + s.location.lon, 0) / on.length;
  const kx = 111320 * Math.cos(rad(lat0)), ky = 110574;
  const pts = on.map((st) => ({ st, lat: st.location.lat, lon: st.location.lon, x: (st.location.lon - lon0) * kx, y: (st.location.lat - lat0) * ky, off: 0 }));
  if (straight) return straightPath(pts, cfg, { noCoord, off, located }, { lat0, lon0, kx, ky });
  const segs = [];
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    pts[i].s = pts[i - 1].s + len;
    segs.push({ dx, dy, len, az: norm360(deg(Math.atan2(dx, dy))) });
  }
  const L = pts[pts.length - 1].s;
  if (L < 5) return { ok: false, reason: 'short', noCoord, off, located };
  const overall = norm360(deg(Math.atan2(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)));
  // azimuth of the section at each station: the mean direction of the segments either side
  pts.forEach((p, i) => {
    let vx = 0, vy = 0;
    for (const sg of [segs[i - 1], segs[i]]) if (sg && sg.len > 0.5) { vx += sg.dx / sg.len; vy += sg.dy / sg.len; }
    p.az = Math.hypot(vx, vy) > 1e-6 ? norm360(deg(Math.atan2(vx, vy))) : overall;
  });
  const bends = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = segs[i - 1], b = segs[i];
    if (a.len < 0.5 || b.len < 0.5) continue;
    const turn = angleDiff(a.az, b.az);
    if (turn > BEND) bends.push({ s: pts[i].s, angle: turn, code: pts[i].st.code });
  }
  const real = segs.filter((sg) => sg.len > 0.5);
  // ground samples every few metres (DEM pixels are about 18 m)
  const ds = clamp(L / 1200, 4, 60);
  const samples = [];
  for (let i = 0; i < segs.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.ceil(segs[i].len / ds));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      samples.push({ s: a.s + f * segs[i].len, lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) });
    }
  }
  const last = pts[pts.length - 1];
  samples.push({ s: last.s, lat: last.lat, lon: last.lon });
  const signature = JSON.stringify(pts.map((p) => [p.st.id, p.lat, p.lon]));
  return { ok: true, line: 'path', pts, segs, L, samples, bends, noCoord, off, located, overall, azStart: real[0]?.az ?? overall, azEnd: real[real.length - 1]?.az ?? overall, signature };
}

/**
 * A straight section through the middle of the stations, across the mean strike of the beds
 * (strikes averaged as axes, so the two limbs of a fold agree; steeper beds count more). With no
 * usable dips the line follows the spread of the stations instead. Every station is projected onto
 * the line at right angles, which is along the strike; p.off is how far it lies from the line.
 */
function straightPath(pts, cfg, base, { lat0, lon0, kx, ky }) {
  let c2 = 0, s2 = 0, w = 0;
  for (const p of pts) {
    const e = effective(p.st, cfg);
    if (e.skip || !e.plane) continue;
    const wt = Math.sin(rad(clamp(e.plane.dip, 0, 90)));
    c2 += wt * Math.cos(rad(2 * e.plane.strike));
    s2 += wt * Math.sin(rad(2 * e.plane.strike));
    w += wt;
  }
  let az, how;
  if (w > 0.05 && Math.hypot(c2, s2) / w > 0.25) {
    const strike = norm360(deg(Math.atan2(s2, c2)) / 2);
    az = norm360(strike + 90) % 180;
    how = 'strike';
  } else {
    // principal axis of the stations' positions
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; }
    az = norm360(90 - deg(0.5 * Math.atan2(2 * sxy, sxx - syy))) % 180;
    how = 'spread';
  }
  if (cfg.flip) az = norm360(az + 180);
  const ux = Math.sin(rad(az)), uy = Math.cos(rad(az));
  for (const p of pts) {
    p.along = p.x * ux + p.y * uy;
    p.off = p.x * uy - p.y * ux; // + = right of the line looking toward A′
  }
  const a0 = Math.min(...pts.map((p) => p.along)), a1 = Math.max(...pts.map((p) => p.along));
  const span = a1 - a0;
  // stations strung out along the strike give a line that is short next to how far they spread
  const spread = 2 * Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
  if (span < Math.max(5, 0.15 * spread)) return { ok: false, reason: 'across', ...base };
  const margin = clamp(span * 0.05, 20, 500);
  const start = a0 - margin;
  const L = span + 2 * margin;
  for (const p of pts) { p.s = p.along - start; p.az = az; }
  pts.sort((a, b) => a.s - b.s);
  const at = (along) => {
    const x = ux * along, y = uy * along;
    return { x, y, lat: lat0 + y / ky, lon: lon0 + x / kx };
  };
  const n = Math.max(2, Math.ceil(L / clamp(L / 1200, 4, 60)));
  const samples = [];
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * L;
    const g = at(start + s);
    samples.push({ s, lat: g.lat, lon: g.lon });
  }
  const signature = JSON.stringify(['strike', Math.round(az * 10), pts.map((p) => [p.st.id, p.lat, p.lon])]);
  return {
    ok: true, line: 'strike', how, pts, segs: [], L, samples, bends: [], ...base,
    overall: az, azStart: az, azEnd: az, ends: [at(start), at(start + L)], signature,
  };
}

function lerpAt(xs, ys, x) {
  const n = xs.length;
  if (!n) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const d = xs[hi] - xs[lo];
  return d > 0 ? ys[lo] + ((x - xs[lo]) / d) * (ys[hi] - ys[lo]) : ys[hi];
}

/** Ground heights along the path: from the DEM sampler, else the stations' GPS heights. */
export function groundLine(path, sampler) {
  if (sampler) {
    const z = path.samples.map((p) => sampler(p.lat, p.lon));
    if (z.every(fin)) return { z, src: 'dem' };
  }
  const known = path.pts.filter((p) => fin(p.st.location.alt));
  if (!known.length) return { z: path.samples.map(() => 0), src: 'none' };
  const xs = known.map((p) => p.s), ys = known.map((p) => p.st.location.alt);
  return { z: path.samples.map((p) => lerpAt(xs, ys, p.s)), src: 'gps' };
}

// ---------- model ----------

/**
 * Everything the drawing needs. `ground` comes from groundLine(); cfg from loadConfig().
 * Rock colours not decided yet are picked and stored in cfg.autoColors (model.cfgChanged).
 */
export function buildModel(path, ground, cfg) {
  const N = path.samples.length;
  const sArr = Float64Array.from(path.samples, (p) => p.s);
  const topo = Float64Array.from(ground.z);
  let zMin = Infinity, zMax = -Infinity;
  for (const z of topo) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; }

  // first and last points of the whole walk (all located stations, on the line or not)
  const ends = walkEnds(path.located || path.pts.map((p) => p.st));
  const pts = path.pts.map((p) => {
    const e = effective(p.st, cfg);
    const app = e.plane && !e.skip ? apparentDip(e.plane, p.az) : null;
    return {
      ...p, ...e, app, faultApps: e.skip ? [] : e.faults.map((f) => ({ ...f, app: apparentDip(f, p.az) })), z: lerpAt(sArr, topo, p.s),
      type: pointType(p.st), shape: shapeOf(p.st, ends),
    };
  });

  // apparent dip along the section, interpolated between stations (same spot → averaged)
  const dipS = [], dipA = [];
  for (const p of pts) {
    if (p.app == null) continue;
    if (dipS.length && Math.abs(dipS[dipS.length - 1] - p.s) < 0.01) {
      const k = dipS.length - 1;
      dipA[k] = (dipA[k] + p.app) / 2;
    } else { dipS.push(p.s); dipA.push(p.app); }
  }
  const aAt = (s) => (dipS.length ? lerpAt(dipS, dipA, s) : 0);
  // S(s): height of a reference bed boundary; every boundary is S(s) + a constant
  const S = new Float64Array(N);
  let gPrev = -Math.tan(rad(aAt(sArr[0])));
  for (let j = 1; j < N; j++) {
    const g = -Math.tan(rad(aAt(sArr[j])));
    S[j] = S[j - 1] + 0.5 * (gPrev + g) * (sArr[j] - sArr[j - 1]);
    gPrev = g;
  }

  // rocks along the ground: stations in order, contacts between different rocks
  const rocks = [];
  const byKey = new Map();
  let cfgChanged = false;
  const rockIndex = (typed) => {
    const key = rockGroup(typed);
    if (byKey.has(key)) { rocks[byKey.get(key)].n++; return byKey.get(key); }
    const idx = rocks.length;
    byKey.set(key, idx);
    rocks.push({ idx, key, ...rockLabel(key, typed), n: 1 });
    return idx;
  };
  const data = pts.filter((p) => !p.skip && p.rock);
  const bounds = [], seq = [], contacts = [];
  data.forEach((p, k) => {
    p.rockIdx = rockIndex(p.rock);
    if (!k) { seq.push(p.rockIdx); return; }
    if (p.rockIdx === seq[seq.length - 1]) return;
    const a = data[k - 1];
    const lowFirst = (a.st.number || 0) <= (p.st.number || 0);
    const key = lowFirst ? `${a.st.id}|${p.st.id}` : `${p.st.id}|${a.st.id}`;
    const f0 = fin(cfg.contacts[key]) ? clamp(cfg.contacts[key], 0, 1) : 0.5;
    const f = lowFirst ? f0 : 1 - f0;
    const s = a.s + f * (p.s - a.s);
    bounds.push(s);
    seq.push(p.rockIdx);
    contacts.push({ a, b: p, s, f, key, lowFirst });
  });
  if (!seq.length) seq.push(-1);
  const rockAt = (s) => {
    let lo = 0, hi = bounds.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (bounds[m] <= s) lo = m + 1; else hi = m; }
    return seq[lo];
  };

  // stratigraphic height of the ground, U = z − S; and where each level comes up to the ground
  const U = new Float64Array(N);
  let Umin = Infinity, Umax = -Infinity, jMin = 0;
  for (let j = 0; j < N; j++) {
    U[j] = topo[j] - S[j];
    if (U[j] < Umin) { Umin = U[j]; jMin = j; }
    if (U[j] > Umax) Umax = U[j];
  }
  const deepRock = rockAt(sArr[jMin]);
  const bins = buildBins(sArr, U, Umin, Umax, rockAt);
  // deepest point of the lowest bed boundary that comes up to the ground (the dashed line)
  let lowBed = Infinity;
  for (let j = 0; j < N; j++) lowBed = Math.min(lowBed, Umin + S[j]);
  // past each end, the ground and the dip are taken to carry on as they are near that end; where
  // the level U falls going outward, deeper beds come up beyond the end (rate in m of U per m)
  const L = sArr[N - 1];
  const w = Math.min(clamp(0.05 * L, 50, 500), L / 2);
  const ends2 = [
    { s: 0, U: U[0], rock: rockAt(0), rate: (lerpAt(sArr, U, w) - U[0]) / w },
    { s: L, U: U[N - 1], rock: rockAt(L), rate: (lerpAt(sArr, U, L - w) - U[N - 1]) / w },
  ].filter((e) => e.rock >= 0);

  // colours and top-to-bottom order of the rocks
  const used = [];
  for (const r of rocks) {
    const typed = data.find((p) => p.rockIdx === r.idx)?.rock || r.name;
    const d = defaultColor(r.key, typed, cfg, used);
    cfgChanged ||= d.changed;
    r.defaultColor = d.color;
    r.color = cfg.colors[r.key] || d.color;
    used.push(r.color);
  }
  const sumU = new Float64Array(rocks.length), nU = new Float64Array(rocks.length);
  for (let j = 0; j < N; j++) { const r = rockAt(sArr[j]); if (r >= 0) { sumU[r] += U[j]; nU[r]++; } }
  rocks.forEach((r) => { r.level = nU[r.idx] ? sumU[r.idx] / nU[r.idx] : -Infinity; });
  const order = [...rocks].sort((a, b) => b.level - a.level);

  const sorted = dipS.length ? [...dipA].map(Math.abs).sort((a, b) => a - b) : [];
  return {
    L: path.L, pts, sArr, topo, S, U, zMin, zMax, Umin, Umax, deepRock, bins, rocks, order, contacts,
    rockAt, aAt, bends: path.bends, ground: ground.src, hasDips: dipS.length > 0,
    medianDip: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    azStart: path.azStart, azEnd: path.azEnd, overall: path.overall, cfgChanged,
    line: path.line || 'path', how: path.how, ends: path.ends, lowBed, ends2,
    offCodes: (path.off || []).map((s) => s.code),
  };
}

/** For every level of U, the places along the section where it meets the ground (sorted). */
function buildBins(sArr, U, Umin, Umax, rockAt) {
  const N = U.length;
  const span = Umax - Umin;
  const nb = span > 1e-6 ? clamp(Math.ceil(span / 0.05), 64, 4096) : 1;
  const du = span > 1e-6 ? span / nb : 1;
  const cnt = new Int32Array(nb);
  const each = (fn) => {
    if (span <= 1e-6) return;
    for (let j = 0; j < N - 1; j++) {
      const u0 = U[j], u1 = U[j + 1];
      const b0 = Math.max(0, Math.ceil((Math.min(u0, u1) - Umin) / du - 0.5));
      const b1 = Math.min(nb - 1, Math.floor((Math.max(u0, u1) - Umin) / du - 0.5));
      for (let b = b0; b <= b1; b++) {
        const ub = Umin + (b + 0.5) * du;
        const f = u1 === u0 ? 0 : (ub - u0) / (u1 - u0);
        fn(b, sArr[j] + f * (sArr[j + 1] - sArr[j]));
      }
    }
  };
  each((b) => { cnt[b]++; });
  const off = new Int32Array(nb + 1);
  for (let b = 0; b < nb; b++) off[b + 1] = off[b] + cnt[b];
  const ps = new Float64Array(off[nb]);
  const rk = new Int16Array(off[nb]);
  const fill = new Int32Array(nb);
  each((b, s) => { const i = off[b] + fill[b]++; ps[i] = s; rk[i] = rockAt(s); });
  return { Umin, nb, du, off, ps, rk };
}

/** Index (into bins.ps / bins.rk) of the place in level bin b nearest to s, or -1. */
function nearestIn(bins, b, s) {
  const lo0 = bins.off[b], hi0 = bins.off[b + 1];
  if (hi0 === lo0) return -1;
  let lo = lo0, hi = hi0 - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bins.ps[m] < s) lo = m + 1; else hi = m; }
  if (lo > lo0 && Math.abs(bins.ps[lo - 1] - s) <= Math.abs(bins.ps[lo] - s)) lo -= 1;
  return lo;
}

/**
 * Rock index underground at distance s and bed level u (= z − S(s)): the rock where this bed
 * comes up to the ground nearest along the section. A bed may also come up just beyond either
 * end of the section (the ground and the dip carried on past the end, see buildModel's ends):
 * it then takes the rock at that end, so the rock seen at the first and last stations goes on
 * down past them instead of vanishing. A bed that comes up nowhere takes the lowest rock seen.
 */
function rockUnder(m, s, u) {
  const bins = m.bins;
  let best = -2, bestD = Infinity;
  if (u >= bins.Umin) {
    const b = Math.min(bins.nb - 1, Math.floor((u - bins.Umin) / bins.du));
    for (let k = 0; k <= 3; k++) {
      for (const bb of k ? [b - k, b + k] : [b]) {
        if (bb < 0 || bb >= bins.nb) continue;
        const i = nearestIn(bins, bb, s);
        if (i >= 0 && Math.abs(bins.ps[i] - s) < bestD) { bestD = Math.abs(bins.ps[i] - s); best = bins.rk[i]; }
      }
      if (best !== -2) break;
    }
  }
  for (const e of m.ends2) {
    const depth = e.U - u;
    if (!(e.rate > 0) || !(depth > 0)) continue;
    const d = Math.abs(s - e.s) + depth / e.rate;
    if (d < bestD) { bestD = d; best = e.rock; }
  }
  return best !== -2 ? best : m.deepRock;
}

// ---------- scales ----------

/** Vertical exaggeration that shows the ground's ups and downs, kept low when beds dip steeply. */
export function autoVE(m) {
  const relief = Math.max(m.zMax - m.zMin, 2);
  const raw = (0.12 * m.L) / relief;
  const cap = m.medianDip < 5 ? 10 : m.medianDip < 15 ? 5 : 2;
  return snap(clamp(raw, 1, cap), NICE_VE);
}
/** Depth below the lowest ground that keeps the picture about half as tall as it is wide. */
/**
 * Depth below the lowest ground: deep enough to show the lowest bed that comes up to the ground
 * all the way across (a fifth more), but no deeper than keeps the picture about half as tall as
 * it is wide. Deeper than the beds seen at the surface would only be guessing.
 */
export function autoDepth(m, ve) {
  const relief = Math.max(m.zMax - m.zMin, 2);
  const fit = (0.45 * m.L) / ve - relief;
  const reach = fin(m.lowBed) ? m.zMin - m.lowBed : 0;
  const want = Math.min(fit, Math.max(1.2 * reach, 0.5 * relief, 20));
  return snap(clamp(want, Math.max(20, 0.3 * relief), Math.max(50, m.L)), NICE_DEPTH);
}

export const distText = (meters) => (meters < 1000 ? `${Math.round(meters)} ${t('ม.', 'm')}` : `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} ${t('กม.', 'km')}`);

function niceStep(range, target) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= raw) return k * p;
  return 10 * p;
}

const hex = (c) => {
  const v = /^#?([0-9a-f]{6})$/i.exec(String(c || ''))?.[1] || '9aa0a6';
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ---------- drawing ----------

const INK = '#1d2329';
const MUTED = '#5b6670';

function halo(ctx, text, x, y, w = 3) {
  ctx.save();
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

/** Paint the rocks under the ground line into the plot box (device pixels), with contact lines. */
function rasterRocks(m, box, rr, under) {
  const PW = Math.max(1, Math.round(box.w * rr)), PH = Math.max(1, Math.round(box.h * rr));
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(PW, PH);
  const px = img.data;
  const lab = new Int16Array(PW * PH).fill(-3); // -3 air, -2 blank, -1 unknown rock, 0.. rock
  const sPerPx = m.L / PW;
  const zPerPx = (box.zTop - box.zBot) / PH;
  const band = 10 * rr; // drawn thickness of the ground band when the underground is hidden
  let j = 0;
  for (let i = 0; i < PW; i++) {
    const s = (i + 0.5) * sPerPx;
    while (j < m.sArr.length - 2 && m.sArr[j + 1] < s) j++;
    const d = m.sArr[j + 1] - m.sArr[j];
    const f = d > 0 ? clamp((s - m.sArr[j]) / d, 0, 1) : 0;
    const zg = m.topo[j] + f * (m.topo[j + 1] - m.topo[j]);
    const Sg = m.S[j] + f * (m.S[j + 1] - m.S[j]);
    const surf = under ? -1 : m.rockAt(s);
    for (let k = 0; k < PH; k++) {
      const z = box.zTop - (k + 0.5) * zPerPx;
      if (z > zg) continue;
      let r;
      if (under) r = rockUnder(m, s, z - Sg);
      else r = (zg - z) / zPerPx <= band ? surf : -2;
      lab[k * PW + i] = r;
    }
  }
  const cols = m.rocks.map((r) => hex(r.color));
  const unk = hex(UNKNOWN_COLOR);
  for (let p = 0, q = 0; p < lab.length; p++, q += 4) {
    const r = lab[p];
    if (r <= -2) continue;
    const c3 = r >= 0 ? cols[r] : unk;
    px[q] = c3[0]; px[q + 1] = c3[1]; px[q + 2] = c3[2]; px[q + 3] = 255;
  }
  // contact lines where neighbouring pixels hold different rocks
  const th = Math.max(1, Math.round(rr * 0.9));
  for (let k = 0; k < PH; k++) {
    for (let i = 0; i < PW; i++) {
      const p = k * PW + i;
      const r = lab[p];
      if (r < -1) continue;
      const right = i + 1 < PW ? lab[p + 1] : r;
      const down = k + 1 < PH ? lab[p + PW] : r;
      if ((right >= -1 && right !== r) || (down >= -1 && down !== r)) {
        for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) {
          const ii = i + b, kk = k + a;
          if (ii >= PW || kk >= PH || lab[kk * PW + ii] < -1) continue;
          const q = (kk * PW + ii) * 4;
          px[q] = 38; px[q + 1] = 38; px[q + 2] = 38; px[q + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Draw the cross section on `canvas`.
 *   mode 'preview': the section only (sized for the phone screen; the app shows the rest)
 *   mode 'export' : a full figure with title, plan of the line, legend and credits
 * o = { mode, width (CSS px), ratio, ve: 'auto'|number, depth: 'auto'|number, under, project, demCredit }
 * Resolves { width, height, ve, depth, clipped, marks: [{ id, x, y }] } in CSS px.
 */
export async function renderSection(canvas, m, o) {
  await loadFonts();
  const exp = o.mode === 'export';
  const W = exp ? 1600 : Math.max(280, o.width);
  const ratio = o.ratio || 1;
  const k = exp ? 1.45 : 1; // text and symbol size
  const padL = exp ? 92 : 42, padR = exp ? 56 : 26; // room on the right for the last dip tick
  const plotW = W - padL - padR;
  const hs = plotW / m.L;
  let ve = o.ve === 'auto' || !fin(o.ve) ? autoVE(m) : o.ve;
  let depth = o.depth === 'auto' || !fin(o.depth) ? autoDepth(m, ve) : o.depth;
  const relief = Math.max(m.zMax - m.zMin, 0.5);
  const maxH = (exp ? 2 : 2.5) * plotW;
  let clipped = false;
  if ((relief + depth) * hs * ve > maxH) {
    clipped = true;
    depth = Math.max(0, maxH / (hs * ve) - relief);
    if (depth < relief * 0.2) { depth = relief * 0.2; ve = Math.max(1, maxH / (hs * (relief + depth))); }
  }
  const vs = hs * ve;
  const zTop = m.zMax, zBot = m.zMin - depth;
  const plotH = Math.max(40, (zTop - zBot) * vs);

  // page layout
  const headH = exp ? 178 : 0;
  const roomTop = exp ? 74 : 54;   // station labels above the highest ground
  const axisB = exp ? 54 : 30;
  const Y0 = headH + roomTop;
  const X = (s) => padL + s * hs;
  const Y = (z) => Y0 + (zTop - z) * vs;
  const ctx = canvas.getContext('2d');
  // the legend under the export is measured first (its notes wrap), then the canvas is sized
  const lay = exp ? legendLayout(ctx, m, o, { W, plotW, ve }) : null;
  const H = Math.round(Y0 + plotH + axisB + (lay ? lay.height : 0));

  canvas.width = Math.round(W * ratio);
  canvas.height = Math.round(H * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // rocks
  // rocks are worked out pixel by pixel: the export at twice its size (smoothed when drawn), the
  // preview at screen resolution with a cap so slow phones stay quick
  const cap = exp ? 12e6 : 4e6;
  let rr = ratio * (exp ? 2 : 1);
  if (plotW * rr * plotH * rr > cap) rr = Math.sqrt(cap / (plotW * plotH));
  const box = { w: plotW, h: plotH, zTop, zBot };
  const rimg = rasterRocks(m, box, rr, o.under !== false);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(rimg, padL, Y0, plotW, plotH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, Y0, plotW, plotH);
  ctx.clip();
  // lowest bed that reaches the ground: below it the deepest rock is carried down
  if (o.under !== false && m.bins.nb > 1) {
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeStyle = 'rgba(29,35,41,0.75)';
    ctx.lineWidth = 1.3 * k;
    ctx.beginPath();
    let pen = false;
    for (let j = 0; j < m.sArr.length; j++) {
      const z = m.Umin + m.S[j];
      if (z < m.topo[j] - 0.3 && z > zBot) {
        if (pen) ctx.lineTo(X(m.sArr[j]), Y(z)); else ctx.moveTo(X(m.sArr[j]), Y(z));
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }
  // where the path turns sharply
  ctx.setLineDash([2 * k, 3 * k]);
  ctx.strokeStyle = 'rgba(29,35,41,0.6)';
  ctx.lineWidth = 1.2 * k;
  for (const b of m.bends) {
    ctx.beginPath();
    ctx.moveTo(X(b.s), Y(lerpAt(m.sArr, m.topo, b.s)) + 3);
    ctx.lineTo(X(b.s), Y0 + plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // height scale on the left, the far end from the ground down, the base, and the ground line
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  const yb = Y0 + plotH - 0.5;
  ctx.beginPath();
  ctx.moveTo(padL + 0.5, Y0);
  ctx.lineTo(padL + 0.5, yb);
  ctx.lineTo(padL + plotW - 0.5, yb);
  ctx.lineTo(padL + plotW - 0.5, Y(m.topo[m.topo.length - 1]));
  ctx.stroke();
  ctx.beginPath();
  for (let j = 0; j < m.sArr.length; j++) {
    const x = X(m.sArr[j]), y = Y(m.topo[j]);
    if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.lineWidth = 2.2 * k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();

  // axes
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${10.5 * k}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const zStep = niceStep(zTop - zBot, plotH / (34 * k) > 6 ? 6 : Math.max(2, plotH / (34 * k)));
  for (let z = Math.ceil(zBot / zStep) * zStep; z <= zTop + 1e-6; z += zStep) {
    const y = Y(z);
    ctx.fillRect(padL - 4 * k, y - 0.5, 4 * k, 1);
    ctx.fillText(String(Math.round(z)), padL - 6 * k, y);
  }
  ctx.textBaseline = 'alphabetic';
  const sStep = niceStep(m.L, Math.max(2, Math.min(8, plotW / (70 * k))));
  const km = m.L >= 1500;
  const yAx = Y0 + plotH + 15 * k;
  ctx.textAlign = 'center';
  for (let s = 0; s <= m.L + 1e-6; s += sStep) {
    const x = X(s);
    ctx.fillRect(x - 0.5, Y0 + plotH, 1, 4 * k);
    const label = km ? `${+(s / 1000).toFixed(sStep < 1000 ? 1 : 0)}` : `${Math.round(s)}`;
    ctx.textAlign = x + 20 * k > padL + plotW ? 'right' : 'center';
    ctx.fillText(label, x, yAx);
  }
  ctx.textAlign = 'left';
  ctx.font = `400 ${10 * k}px ${SANS}`;
  ctx.fillText(exp ? t('ม. รทก.', 'm MSL') : t('ม.', 'm'), 6 * k, Y0 - 8 * k);
  ctx.textAlign = 'right';
  ctx.fillText(km ? t('ระยะ (กม.)', 'distance (km)') : t('ระยะ (ม.)', 'distance (m)'), padL + plotW, Y0 + plotH + 28 * k);

  // ends of the section: A at the start, A′ at the end, with the compass direction beyond each end
  ctx.font = `600 ${11 * k}px ${SANS}`;
  const endTag = (text, x, align) => {
    ctx.textAlign = align;
    const w = ctx.measureText(text).width + 10 * k;
    const bx = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(bx, Y0 + plotH - 19 * k, w, 16 * k);
    ctx.fillStyle = INK;
    ctx.fillText(text, align === 'left' ? x + 5 * k : x - 5 * k, Y0 + plotH - 7 * k);
  };
  endTag(`A · ${cardinal(m.azStart + 180)}`, padL + 2, 'left');
  endTag(`A′ · ${cardinal(m.azEnd)}`, padL + plotW - 2, 'right');

  // stations: each point's symbol on the ground (js/pointtype.js — square = station, circle =
  // check point, triangle = first or last point of the walk) with its dip tick coming out of it,
  // and the code above (stacked when crowded)
  const marks = [];
  const placed = [];
  const labelFont = `500 ${10.5 * k}px ${MONO}`;
  const R = 6.2 * k; // symbol size: the circle's radius
  const sorted = [...m.pts].sort((a, b) => a.s - b.s);
  for (const p of sorted) {
    const x = X(p.s), yg = Y(p.z);
    // ticks start at the point; the symbol drawn next covers their start
    if (p.app != null) drawTick(ctx, x, yg, p.app, ve, R + 17 * k, INK, 1.9 * k, false, `${Math.round(p.plane.dip)}°`, k);
    for (const f of p.faultApps) drawTick(ctx, x, yg, f.app, ve, R + 27 * k, '#c0392b', 1.8 * k, true, '', k);
  }
  for (const p of sorted) {
    const x = X(p.s), yg = Y(p.z);
    const fill = p.skip || p.rockIdx == null ? '#ffffff' : m.rocks[p.rockIdx].color;
    ctx.save();
    ctx.lineJoin = 'round';
    pathShape(ctx, p.shape, x, yg, R);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.6 * k + 3;
    ctx.stroke();
    pathShape(ctx, p.shape, x, yg, R);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6 * k;
    ctx.stroke();
    ctx.restore();
    marks.push({ id: p.st.id, x, y: yg });
    // label
    ctx.font = labelFont;
    const text = exp || W >= 520 ? p.st.code : String(p.st.number ?? p.st.code);
    const w = ctx.measureText(text).width;
    const top = yg - R * 1.25 - 3 * k; // just above the symbol
    for (let lv = 0; lv < 3; lv++) {
      const by = top - 3 * k - lv * 13 * k;
      const bx = clamp(x - w / 2, 1, W - w - 1);
      const r = { x0: bx - 2, x1: bx + w + 2, y0: by - 10 * k, y1: by + 2 };
      if (r.y0 < headH + 2) break;
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
      placed.push(r);
      if (lv) {
        ctx.strokeStyle = 'rgba(29,35,41,0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, by + 1); ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = p.skip ? MUTED : INK;
      halo(ctx, text, bx, by, 3);
      break;
    }
  }

  if (exp) drawFigureExtras(ctx, m, o, { W, H, padL, plotW, Y0, plotH, headH, ve, axisB, k, lay });
  return { width: W, height: H, ve, depth, clipped, marks };
}

/** Dip tick from the ground point: down toward the dip, drawn with the vertical exaggeration. */
function drawTick(ctx, x, y, app, ve, len, color, lw, dashed, label, k) {
  const a = Math.atan(ve * Math.tan(rad(Math.abs(app))));
  const dir = app >= 0 ? 1 : -1;
  let x0 = x, y0 = y, x1, y1;
  if (Math.abs(app) < 0.5) { x0 = x - len * 0.85; x1 = x + len * 0.85; y1 = y0; }
  else { x1 = x + dir * Math.cos(a) * len; y1 = y0 + Math.sin(a) * len; }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = lw + 2.4;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (dashed) ctx.setLineDash([4 * k, 3 * k]);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
  if (label) {
    ctx.font = `500 ${9.5 * k}px ${MONO}`;
    ctx.fillStyle = color;
    // keep the number on the picture: near the edges it goes on the other side of the tick end
    const w = ctx.measureText(label).width;
    const W = ctx.canvas.width / (ctx.getTransform().a || 1);
    let right = x1 >= x;
    if (right && x1 + 2 * k + w > W - 2) right = false;
    else if (!right && x1 - 2 * k - w < 2) right = true;
    ctx.textAlign = right ? 'left' : 'right';
    halo(ctx, label, x1 + (right ? 2 : -2) * k, y1 + 9 * k, 2.6);
  }
}

// ---------- the full figure (export) ----------

const legendCols = (W) => Math.max(1, Math.floor((W - 140) / 360));

/** The symbols that appear in this picture, each [draw(ctx, x, y), text]. */
function symbolRows(m, under) {
  const rows = [];
  // the point symbols in use, side by side on one row (the row draws its own words)
  const shapes = new Set(m.pts.map((p) => p.shape));
  const items = [
    ['square', t('Station (วัด strike/dip แล้ว)', 'Station (strike/dip measured)')],
    ['circle', t('Check point (ตรวจสอบหิน)', 'Check point (rock checked)')],
    ['tri', t('จุดแรก / จุดสุดท้ายของแนวเดิน', 'First / last point of the walk')],
  ].filter(([k]) => shapes.has(k));
  if (items.length) {
    rows.push([(ctx, x0, y0) => {
      let x = x0;
      ctx.font = `400 15px ${SANS}`;
      ctx.textAlign = 'left';
      for (const [shape, label] of items) {
        pathShape(ctx, shape, x + 12, y0, 7.5);
        ctx.fillStyle = '#d9d4c7'; ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.fillStyle = MUTED;
        ctx.fillText(label, x + 28, y0 + 5);
        x += 28 + ctx.measureText(label).width + 30;
      }
    }, null]);
  }
  const faults = m.pts.some((p) => p.faultApps.length);
  if (m.hasDips || faults) {
    rows.push([(ctx, x0, y0) => { ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x0 + 4, y0 - 6); ctx.lineTo(x0 + 30, y0 + 8); ctx.stroke(); },
      t('ขีดมุมเอียง: มุมเอียงปรากฏตามแนวตัด (ตัวเลขคือมุมเอียงจริงที่วัด)', 'Dip tick: apparent dip along the section (number = measured true dip)')
        + (faults ? t(' · สีแดงประ: รอยเลื่อน', ' · red dashed: fault') : '')]);
  }
  if (under && m.bins.nb > 1) {
    rows.push([(ctx, x0, y0) => { ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(x0 + 2, y0); ctx.lineTo(x0 + 34, y0); ctx.stroke(); ctx.setLineDash([]); },
      t('ต่ำกว่าเส้นประ: ชั้นที่ไม่โผล่ให้เห็นในแนวนี้ ต่อจากหินที่ปลายแนวหรือหินชั้นล่างสุดที่พบ', 'Below the dashed line: beds that do not come up on this line, carried on from the rock at an end or the lowest rock seen')]);
  }
  const hollow = m.pts.some((p) => p.skip);
  if (m.bends.length) {
    rows.push([(ctx, x0, y0) => { ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x0 + 18, y0 - 9); ctx.lineTo(x0 + 18, y0 + 9); ctx.stroke(); ctx.setLineDash([]); },
      t(`เส้นจุดแนวตั้ง: แนวเดินเปลี่ยนทิศเกิน ${BEND}° ภาพช่วงนั้นบิดได้`, `Dotted line: the path turns more than ${BEND}°; the picture bends there`)]);
  }
  if (hollow) {
    rows.push([(ctx, x0, y0) => { pathShape(ctx, 'square', x0 + 18, y0, 7.5); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke(); },
      t('สัญลักษณ์สีขาว: จุดที่ไม่ใช้ข้อมูลในภาพนี้ (เช่นหินที่ไม่อยู่ในที่)', 'White symbol: a point whose data are not used in this picture (e.g. rock not in place)')]);
  }
  return rows;
}

/** What was changed from the notebook for this picture, station by station. */
function editNotes(m) {
  const out = [];
  for (const p of m.pts) {
    if (!p.edited) continue;
    const what = [];
    if (p.skip) what.push(t('ไม่ใช้ข้อมูล', 'not used'));
    else {
      if (p.rock !== p.nbRock) what.push(`${t('หิน', 'rock')} ${p.rock || '—'}`);
      if (!p.plane && p.nbPlane) what.push(t('ไม่ใช้มุมเอียง', 'dip not used'));
      else if (p.plane && (!p.nbPlane || Math.abs(p.plane.dip - p.nbPlane.dip) > 0.05 || angleDiff(p.plane.dipdir, p.nbPlane.dipdir) > 0.05)) {
        what.push(`${t('มุมเอียง', 'dip')} ${az3(p.plane.strike)}/${Math.round(p.plane.dip * 10) / 10}`);
      }
    }
    if (what.length) out.push(`${p.st.code} ${what.join(', ')}`);
  }
  if (m.offCodes?.length) out.push(`${t('ไม่อยู่ในแนวตัด', 'left off the line')} ${m.offCodes.join(', ')}`);
  return out;
}

function notesText(m, o, ve) {
  const edits = editNotes(m);
  return [
    t('ส่วนใต้ดินคาดคะเนจากชนิดหินและมุมเอียงที่บันทึกในสนาม ไม่ใช่ผลเจาะสำรวจ', 'Below ground is inferred from the rocks and dips recorded in the field, not from drilling.'),
    ve > 1 ? t(`แกนตั้งขยาย ×${+ve.toFixed(1)} มุมเอียงบนภาพจึงชันกว่าจริง`, `Vertical scale ×${+ve.toFixed(1)}: dips look steeper than they are.`) : '',
    edits.length ? `${t('แก้จากสมุดบันทึกเฉพาะในภาพนี้', 'Changed from the notebook for this picture only')}: ${edits.join(' · ')}` : '',
    m.ground === 'dem' ? `${t('ความสูงพื้นดิน', 'Ground')}: ${o.demCredit || ''}`
      : m.ground === 'gps' ? t('ความสูงพื้นดิน: ความสูงจาก GPS ของแต่ละ Station (หยาบ ±10–20 ม.)', 'Ground: GPS heights of the stations (rough, ±10–20 m)')
        : t('ความสูงพื้นดิน: ไม่มีข้อมูล (วาดเป็นพื้นราบ)', 'Ground: no height data (drawn flat)'),
  ].filter(Boolean).join(' · ');
}

/** Sizes of the export legend: rock rows, symbol rows and the wrapped notes. */
function legendLayout(ctx, m, o, { W, plotW, ve }) {
  const cols = legendCols(W);
  const rockRows = Math.ceil(Math.max(1, m.order.length) / cols);
  const syms = symbolRows(m, o.under !== false);
  ctx.font = `400 15px ${SANS}`;
  const noteLines = wrap(ctx, notesText(m, o, ve), plotW, 7);
  const height = 42 + rockRows * 34 + 20 + syms.length * 30 + 6 + noteLines.length * 22 + 54;
  return { cols, rockRows, syms, noteLines, height };
}

function drawFigureExtras(ctx, m, o, g) {
  const { W, padL, plotW, Y0, plotH, ve, axisB } = g;
  const project = o.project || {};
  // title
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `600 34px ${SANS}`;
  const titleW = W - padL - 360;
  const title = `${t('ภาพตัดขวาง', 'Cross section')} · ${project.name || ''}`;
  ctx.fillText(wrap(ctx, title, titleW, 1)[0], padL, 62);
  ctx.font = `400 19px ${SANS}`;
  ctx.fillStyle = MUTED;
  const first = m.pts[0].st, last = m.pts[m.pts.length - 1].st;
  const straight = m.line === 'strike' && m.ends;
  const sub1 = !straight
    ? `${t('แนวเดินตามลำดับ Station', 'Along the stations in order')} ${first.code} → ${last.code} (${m.pts.length} Stations)`
    : m.how === 'strike'
      ? `${t('แนวตรงตั้งฉากกับแนวระดับเฉลี่ยของชั้นหิน', 'Straight line across the mean strike of the beds')} (${t('ทิศ', 'bearing')} ${az3(m.overall)}°) · ${t(`ฉาย ${m.pts.length} Station ลงแนวตามแนวระดับ`, `${m.pts.length} stations projected along strike`)}`
      : `${t('แนวตรงตามการกระจายของ Station (ไม่มีมุมเอียงให้หาแนวระดับ)', 'Straight line along the spread of the stations (no dips to find the strike)')} (${t('ทิศ', 'bearing')} ${az3(m.overall)}°)`;
  const sub2 = `${t('ยาว', 'Length')} ${distText(m.L)} · V.E. ×${+ve.toFixed(1)} · ${new Date().toLocaleDateString(isEn() ? 'en-GB' : 'th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const lines1 = wrap(ctx, sub1, titleW, 2);
  lines1.forEach((line, i) => ctx.fillText(line, padL, 98 + i * 26));
  ctx.fillText(sub2, padL, 98 + lines1.length * 26);

  // plan of the line (north up)
  const bw = 300, bh = 150, bx = W - 48 - bw, by = 22;
  ctx.strokeStyle = '#c9c4ba';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  const xs = m.pts.map((p) => p.x), ys = m.pts.map((p) => p.y);
  if (straight) for (const e of m.ends) { xs.push(e.x); ys.push(e.y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sc = Math.min((bw - 60) / Math.max(1, maxX - minX), (bh - 40) / Math.max(1, maxY - minY));
  const cx = bx + bw / 2 - ((minX + maxX) / 2) * sc, cy = by + bh / 2 + ((minY + maxY) / 2) * sc;
  const P = (p) => [cx + p.x * sc, cy - p.y * sc];
  ctx.beginPath();
  if (straight) {
    const [x0, y0] = P(m.ends[0]), [x1, y1] = P(m.ends[1]);
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  } else m.pts.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (straight) {
    // each station to where it lands on the line
    const ux = Math.sin(rad(m.overall)), uy = Math.cos(rad(m.overall));
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1;
    for (const p of m.pts) {
      const [x0, y0] = P(p), [x1, y1] = P({ x: ux * p.along, y: uy * p.along });
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }
  for (const p of m.pts) {
    const [x, y] = P(p);
    pathShape(ctx, p.shape, x, y, 5);
    ctx.fillStyle = p.skip || p.rockIdx == null ? '#ffffff' : m.rocks[p.rockIdx].color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.font = `600 16px ${SANS}`;
  ctx.fillStyle = INK;
  const [ax, ay] = P(straight ? m.ends[0] : m.pts[0]);
  const [ex, ey] = P(straight ? m.ends[1] : m.pts[m.pts.length - 1]);
  ctx.textAlign = 'center';
  halo(ctx, 'A', ax, ay - 9, 3);
  halo(ctx, 'A′', ex, ey - 9, 3);
  // north arrow
  const nx = bx + bw - 20, ny = by + 16;
  ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx - 6, ny + 16); ctx.lineTo(nx + 6, ny + 16); ctx.closePath();
  ctx.fill();
  ctx.font = `600 13px ${SANS}`;
  ctx.fillText('N', nx, ny + 31);
  ctx.font = `400 13px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(t('แนวตัดบนแผนที่ (ทิศเหนือขึ้น)', 'Section line in plan (north up)'), bx + 8, by + bh - 9);

  // legend: rocks top to bottom, the symbols used, then notes
  const { cols, syms, noteLines } = g.lay;
  let y = Y0 + plotH + axisB + 26;
  ctx.textAlign = 'left';
  ctx.font = `600 18px ${SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText(t('หิน (เรียงจากชั้นบนลงชั้นล่างตามที่คำนวณได้)', 'Rocks (top to bottom, as worked out)'), padL, y);
  y += 16;
  const colW = plotW / cols;
  ctx.font = `400 17px ${SANS}`;
  m.order.forEach((r, i) => {
    const cx2 = padL + (i % cols) * colW, cy2 = y + Math.floor(i / cols) * 34;
    ctx.fillStyle = r.color;
    ctx.fillRect(cx2, cy2 + 6, 34, 22);
    ctx.strokeStyle = 'rgba(29,35,41,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx2 + 0.5, cy2 + 6.5, 33, 21);
    ctx.fillStyle = INK;
    const label = r.th ? `${r.name} ${r.th}` : r.name;
    ctx.fillText(wrap(ctx, label, colW - 50, 1)[0], cx2 + 44, cy2 + 23);
  });
  if (!m.order.length) { ctx.fillStyle = MUTED; ctx.fillText(t('ยังไม่มีชนิดหินที่บันทึกไว้', 'No rock types recorded yet'), padL, y + 23); }
  y += g.lay.rockRows * 34 + 20;

  ctx.font = `400 15px ${SANS}`;
  for (const [draw, text] of syms) {
    ctx.save();
    draw(ctx, padL, y);
    ctx.restore();
    if (text) {
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText(wrap(ctx, text, plotW - 46, 1)[0], padL + 46, y + 5);
    }
    y += 30;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 15px ${SANS}`;
  noteLines.forEach((line, i) => ctx.fillText(line, padL, y + 6 + i * 22));
  ctx.textAlign = 'right';
  ctx.font = `600 15px ${SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText('GeoNote', W - 48, g.H - 16);
}
