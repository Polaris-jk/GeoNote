// Station or check point, and the symbol each point is drawn with.
//
//   Station     — an outcrop studied closely: at least one strike/dip has been measured there
//   Check point — a quick stop on the way to check the rock, with no attitude measured
// A point can be set either way by hand in its notebook page (st.kind = 'station' | 'check');
// otherwise ('auto' or no value) the app decides from the measurements, so a check point turns
// into a station as soon as a strike/dip is recorded there.
//
// Symbols on the map, the summary picture and the cross section:
//   ■ square   Station
//   ● circle   Check point
//   ▲ triangle the first and the last point of the walk (in the order they were recorded)

import { t } from './i18n.js';

export const KINDS = ['auto', 'station', 'check'];

/** True when a structure at this point has its attitude: a dip plus a strike or dip direction. */
export const hasAttitude = (st) => (st?.measurements || []).some((m) => m
  && Number.isFinite(m.dip) && (Number.isFinite(m.strike) || Number.isFinite(m.dipdir)));

/** 'station' or 'check'. */
export function pointType(st) {
  if (st?.kind === 'station' || st?.kind === 'check') return st.kind;
  return hasAttitude(st) ? 'station' : 'check';
}
export const isAutoType = (st) => st?.kind !== 'station' && st?.kind !== 'check';
export const typeName = (type) => (type === 'check' ? 'Check point' : 'Station');

/** Ids of the first and last points of the walk: located points in the order they were recorded. */
export function walkEnds(stations) {
  const located = (stations || []).filter((s) => s?.location)
    .sort((a, b) => (a.number || 0) - (b.number || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return located.length ? new Set([located[0].id, located[located.length - 1].id]) : new Set();
}

/** 'tri' (first or last point of the walk), 'square' (station) or 'circle' (check point). */
export function shapeOf(st, ends) {
  if (ends?.has(st.id)) return 'tri';
  return pointType(st) === 'station' ? 'square' : 'circle';
}

export function shapeName(shape) {
  if (shape === 'tri') return t('จุดแรก / จุดสุดท้ายของแนวเดิน', 'First / last point of the walk');
  return shape === 'square' ? 'Station' : 'Check point';
}

// ---------- drawing ----------

// shapes in a 30 × 30 box centred on (15, 15), the size of a map pin
const SVG = {
  square: '<rect x="8" y="8" width="14" height="14"/>',
  circle: '<circle cx="15" cy="15" r="8"/>',
  tri: '<path d="M15 5.5 24.5 22H5.5z"/>',
};

/** The symbol as inline SVG: a light halo, then the shape filled with `fill` and outlined. */
export function shapeSVG(shape, fill = '#ffffff', cls = 'pt-shape') {
  const s = SVG[shape] || SVG.circle;
  return `<svg class="${cls}" viewBox="0 0 30 30" aria-hidden="true"><g class="halo">${s}</g><g class="body" style="fill:${fill}">${s}</g></svg>`;
}

/** Trace the symbol on a canvas, centred on (x, y); r is the circle's radius (others match it). */
export function pathShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'square') {
    const a = r * 0.88;
    ctx.rect(x - a, y - a, 2 * a, 2 * a);
  } else if (shape === 'tri') {
    ctx.moveTo(x, y - r * 1.2);
    ctx.lineTo(x + r * 1.18, y + r * 0.86);
    ctx.lineTo(x - r * 1.18, y + r * 0.86);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}
