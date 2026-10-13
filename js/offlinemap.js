// Offline street maps, one file per region (js/regions.js), from OpenStreetMap data.
//
// tile.openstreetmap.org does not allow apps to download its tiles in advance, so each region is
// a separate file built from OpenStreetMap data by the Colab notebook (data/map/<region>.pmtiles).
// A region is downloaded once and kept on the phone in IndexedDB, then drawn with
// protomaps-leaflet (vendor/offline-map.js) with no network at all. Isan is fetched by itself the
// first time the app is opened online (see autoFetchIsan).

/* global LodestarOffline */
import * as db from './db.js';
import { REGIONS, manifest, regionById, regionName } from './regions.js';
import { t, getLang } from './i18n.js';

export const ATTRIBUTION = '© OpenStreetMap contributors · Protomaps';
export const BUNDLED = 'isan';
const kvKey = (id) => `offline-map-${id}`;

const listeners = new Set();
let downloading = null; // { id, got, total }
let cache = null;       // Promise<Map<id, Blob>>

const emit = () => listeners.forEach((fn) => fn({ downloading }));
/** Called whenever a region is added or removed, or download progress changes. */
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const busy = () => downloading;

/** Every region map kept on the phone: Map(id → Blob). */
export function stored() {
  if (!cache) {
    cache = (async () => {
      const out = new Map();
      for (const r of REGIONS) {
        try { const v = await db.get('kv', kvKey(r.id)); if (v?.blob) out.set(r.id, v.blob); } catch { /* none */ }
      }
      return out;
    })();
  }
  return cache;
}

export async function hasAny() { return (await stored()).size > 0; }
export async function sizeOf(id) { return (await stored()).get(id)?.size || 0; }

/**
 * Download one region's map and keep it. onProgress(got, total).
 * A map is published as one file or, so each file fits GitHub's 25 MB web-upload limit, as pieces
 * (data/map/<id>.pmtiles.001, .002 …) listed in regions.json; the pieces are joined here.
 */
export async function download(id, onProgress = () => {}) {
  if (downloading) throw new Error(t('กำลังดาวน์โหลดแผนที่อีกภาคอยู่ รอให้เสร็จก่อน', 'Another region map is downloading; wait for it to finish'));
  const m = await manifest();
  const entry = m.map[id] || {};
  const files = entry.parts?.length ? entry.parts : [entry.file || `data/map/${id}.pmtiles`];
  downloading = { id, got: 0, total: entry.bytes || 0 };
  emit();
  try {
    const chunks = [];
    for (const file of files) {
      const before = downloading.got;
      const n = chunks.length;
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(file, { cache: 'no-store' });
          if (!res.ok) throw Object.assign(new Error(res.status === 404 ? t('ยังไม่มีไฟล์แผนที่ภาคนี้บนเว็บ', 'This region map is not on the website yet') : `HTTP ${res.status}`), { final: res.status === 404 });
          if (files.length === 1 && !downloading.total) downloading.total = Number(res.headers.get('content-length')) || 0;
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            downloading.got += value.length;
            onProgress(downloading.got, downloading.total);
            emit();
          }
          break;
        } catch (err) {
          // a dropped connection mid-piece: start that piece again (up to 3 tries)
          chunks.length = n;
          downloading.got = before;
          if (err.final || attempt >= 3) throw err;
        }
      }
    }
    if (entry.bytes && downloading.got !== entry.bytes) {
      throw new Error(t('ไฟล์แผนที่ไม่ครบ ลองดาวน์โหลดใหม่', 'The map file is incomplete; please download again'));
    }
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
    await db.put('kv', { blob, at: Date.now() }, kvKey(id));
    (await stored()).set(id, blob);
    return blob;
  } finally {
    downloading = null;
    emit();
  }
}

export async function remove(id) {
  await db.del('kv', kvKey(id));
  (await stored()).delete(id);
  emit();
}

/** Promise of { group, background }: a Leaflet layer group with every stored region. */
export async function layer() {
  if (typeof LodestarOffline === 'undefined') throw new Error('offline map renderer missing');
  const items = [...(await stored())].map(([id, blob]) => ({ id, blob }));
  return LodestarOffline.offlineLayers(items, { flavor: 'light', lang: getLang(), maxZoom: 20, attribution: ATTRIBUTION });
}

/**
 * Draw the stored region maps north up into a canvas, for pictures (the summary map).
 * opts: { width, height, lat, lon, zoom, bounds: { west, south, east, north } }.
 * Resolves { canvas, drawn }; drawn is 0 when no stored region reaches the area.
 */
export async function renderArea(opts) {
  if (typeof LodestarOffline === 'undefined' || !LodestarOffline.renderArea) return { canvas: null, drawn: 0 };
  const items = [...(await stored())].map(([id, blob]) => ({ id, blob }));
  if (!items.length) return { canvas: null, drawn: 0 };
  return LodestarOffline.renderArea(items, { flavor: 'light', lang: getLang(), ...opts });
}

/**
 * The Isan map "comes with the app": fetched in the background the first time the app is open
 * with internet, retried on later launches until it succeeds. Not again once the user removed it.
 */
export async function autoFetchIsan(settings, notify) {
  if (settings.offlineIsanSkip || !navigator.onLine || navigator.connection?.saveData) return;
  if ((await stored()).has(BUNDLED) || downloading) return;
  const m = await manifest();
  if (!m.map[BUNDLED]) return; // not published yet
  try {
    notify?.(t(`กำลังโหลดแผนที่ออฟไลน์${regionName(regionById(BUNDLED))}เก็บไว้ในเครื่อง (ครั้งเดียว)`, `Saving the ${regionName(regionById(BUNDLED))} offline map on this phone (once)`));
    await download(BUNDLED);
    notify?.(t(`แผนที่ออฟไลน์${regionName(regionById(BUNDLED))}พร้อมใช้แล้ว`, `${regionName(regionById(BUNDLED))} offline map is ready`));
  } catch { /* try again next launch */ }
}
