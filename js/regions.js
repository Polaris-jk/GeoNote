import { t } from './i18n.js';
// The six regions the offline data is split into. `th` is what the app shows; `id` is only used
// in file names (data/geol/<id>.geojson, data/map/<id>.pmtiles) and is never shown to the user. Boxes are [west, south, east, north] in degrees
// and are checked in this order, so a place inside two boxes belongs to the first one.
// The boundaries are approximate (straight lines), not the official province lists.
// Keep in step with REGIONS in the Colab notebook GeoNote_offline_data.ipynb.

export const REGIONS = [
  { id: 'isan', th: 'ภาคตะวันออกเฉียงเหนือ', en: 'Northeast', note: 'ติดมากับแอป · รวมเลย เพชรบูรณ์ สระบุรี', noteEn: 'Comes with the app · includes Loei, Phetchabun, Saraburi', box: [100.8, 14.0, 105.7, 18.5] },
  { id: 'north', th: 'ภาคเหนือ', en: 'North', note: 'ถึงพิษณุโลก สุโขทัย ตาก', noteEn: 'Down to Phitsanulok, Sukhothai, Tak', box: [97.3, 16.5, 101.5, 20.5] },
  { id: 'west', th: 'ภาคตะวันตก', en: 'West', note: 'กาญจนบุรี ราชบุรี เพชรบุรีตอนใน ประจวบฯ', noteEn: 'Kanchanaburi, Ratchaburi, inland Phetchaburi, Prachuap', box: [97.3, 11.5, 99.6, 16.5] },
  { id: 'central', th: 'ภาคกลาง', en: 'Central', note: 'นครสวรรค์ถึงกรุงเทพฯ และชายฝั่งหัวหิน', noteEn: 'Nakhon Sawan to Bangkok and the Hua Hin coast', box: [99.6, 12.0, 100.85, 16.5] },
  { id: 'east', th: 'ภาคตะวันออก', en: 'East', note: 'ชลบุรี ระยอง จันทบุรี ตราด สระแก้ว', noteEn: 'Chonburi, Rayong, Chanthaburi, Trat, Sa Kaeo', box: [100.85, 11.5, 103.0, 14.0] },
  { id: 'south', th: 'ภาคใต้', en: 'South', note: 'ชุมพรลงไป', noteEn: 'Chumphon and further south', box: [97.3, 5.6, 102.2, 11.5] },
];

export const regionById = (id) => REGIONS.find((r) => r.id === id) || null;
/** "ภาคเหนือ" in Thai, "North" in English. */
export const regionName = (r) => (r ? t(r.th, `${r.en} region`) : '');
export const regionNote = (r) => (r ? t(r.note, r.noteEn) : '');

/** The region a point falls in, or null outside Thailand's boxes. */
export function regionAt(lat, lon) {
  return REGIONS.find(({ box: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n) || null;
}

// ---------- what the website has (data/regions.json, written by the notebook) ----------
let manifestJob = null;

/** { geol: { id: {file, bytes, units} }, map: { id: {file, bytes, maxzoom} } }; empty when missing. */
export function manifest() {
  if (!manifestJob) {
    manifestJob = fetch('data/regions.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m) => ({ geol: m.geol || {}, map: m.map || {}, generated: m.generated || '' }));
  }
  return manifestJob;
}
