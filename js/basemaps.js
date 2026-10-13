// Background maps: the street map (OpenStreetMap) and satellite imagery.
//
// Satellite imagery, the first one that is set up in js/config.js:
//   1. Google satellite (Map Tiles API) — GOOGLE_MAPS_API_KEY
//   2. Esri World Imagery (ArcGIS Location Platform) — ARCGIS_API_KEY
//   3. Sentinel-2 cloudless by EOX — no key, free for non-commercial use, 10 m pixels
// If Google cannot be used (wrong key, billing not enabled…), the next one is used instead.

/* global L */
// namespace import: an older config.js without one of the keys must not stop the app from loading
import * as config from './config.js';
import { t } from './i18n.js';

const GOOGLE_MAPS_API_KEY = String(config.GOOGLE_MAPS_API_KEY || '').trim();
const ARCGIS_API_KEY = String(config.ARCGIS_API_KEY || '').trim();

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const EOX_YEAR = 2024;
const SOURCES = {
  google: { id: 'google', name: 'Google', res: '≈0.3–0.5 m' },
  esri: { id: 'esri', name: 'Esri World Imagery', res: '≈0.3–1 m' },
  eox: { id: 'eox', name: `Sentinel-2 cloudless ${EOX_YEAR}`, res: '10 m' },
};
let googleBroken = false;

/** The satellite imagery in use. */
export function satelliteSource() {
  if (GOOGLE_MAPS_API_KEY && !googleBroken) return SOURCES.google;
  if (ARCGIS_API_KEY) return SOURCES.esri;
  return SOURCES.eox;
}

// ---------- Google Map Tiles API ----------
// Tiles need a session token (valid about two weeks); it is kept in the browser and reused.

const SESSION_KEY = 'lodestar.googleSession';
let sessionJob = null;
const keyTag = () => GOOGLE_MAPS_API_KEY.slice(-8);

function googleSession() {
  if (sessionJob) return sessionJob;
  sessionJob = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (c && c.k === keyTag() && c.session && c.expiry * 1000 - Date.now() > 24 * 3600e3) return c.session;
    } catch { /* storage unavailable */ }
    const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'th', region: 'TH' }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error?.message || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const j = await res.json();
    if (!j.session) throw new Error(t('ไม่ได้รับ session', 'no session received'));
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ k: keyTag(), session: j.session, expiry: Number(j.expiry) || 0 })); } catch { /* ignore */ }
    return j.session;
  })();
  sessionJob.catch(() => { sessionJob = null; });
  return sessionJob;
}

const GoogleLayer = L.TileLayer.extend({
  initialize(options) {
    L.TileLayer.prototype.initialize.call(this, '', options);
    this._copy = null;
    this._timer = null;
    this._failed = false;
    this._vpDone = null;
  },

  createTile(coords, done) {
    const tile = document.createElement('img');
    L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    googleSession().then((s) => {
      tile.src = `https://tile.googleapis.com/v1/2dtiles/${coords.z}/${coords.x}/${coords.y}?session=${encodeURIComponent(s)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
    }, (err) => {
      done(err, tile);
      this._fail(err);
    });
    return tile;
  },

  onAdd(map) {
    L.TileLayer.prototype.onAdd.call(this, map);
    this._setCopy('Google Maps');
    map.on('moveend', this._viewport, this);
    this._viewport();
  },

  onRemove(map) {
    map.off('moveend', this._viewport, this);
    clearTimeout(this._timer);
    if (this._copy) map.attributionControl?.removeAttribution(this._copy);
    this._copy = null;
    L.TileLayer.prototype.onRemove.call(this, map);
  },

  _setCopy(text) {
    const ctl = this._map?.attributionControl;
    if (!ctl || text === this._copy) return;
    if (this._copy) ctl.removeAttribution(this._copy);
    ctl.addAttribution(text);
    this._copy = text;
  },

  /** Google asks apps to show the copyright of the imagery in view; it also tells how far it zooms here. */
  _viewport() {
    clearTimeout(this._timer);
    this._timer = setTimeout(async () => {
      const map = this._map;
      if (!map) return;
      try {
        const z = Math.round(map.getZoom());
        // one request covers a wider area; small pans (e.g. following the GPS) need no new one
        if (this._vpDone && this._vpDone.z === z && this._vpDone.b.contains(map.getBounds())) return;
        const s = await googleSession();
        const b = map.getBounds().pad(0.5);
        const q = new URLSearchParams({
          session: s, key: GOOGLE_MAPS_API_KEY, zoom: String(z),
          north: b.getNorth().toFixed(6), south: b.getSouth().toFixed(6), east: b.getEast().toFixed(6), west: b.getWest().toFixed(6),
        });
        const res = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${q}`);
        if (!res.ok || this._map !== map) return;
        const j = await res.json();
        this._vpDone = { z, b };
        this._setCopy(j.copyright ? `Google Maps · ${j.copyright}` : 'Google Maps');
        // deepest zoom with imagery at the centre of the view
        const c = map.getCenter();
        const here = (j.maxZoomRects || []).filter((r) => c.lat <= r.north && c.lat >= r.south && c.lng <= r.east && c.lng >= r.west);
        if (here.length) {
          const mz = Math.max(...here.map((r) => r.maxZoom));
          const want = Math.max(10, Math.min(this.options.maxZoom, mz));
          if (want !== this.options.maxNativeZoom) {
            this.options.maxNativeZoom = want;
            this._resetView();
          }
        }
      } catch { /* keep the last credit */ }
    }, 350);
  },

  _fail(err) {
    if (this._failed) return;
    this._failed = true;
    googleBroken = true;
    this.fire('sourcefail', { error: err });
  },
});

/**
 * Tiles for drawing a background into a picture (the summary map): 'osm' or 'sat'.
 * Resolves { url(z, x, y), maxZoom, credit } — credit is the text the picture must carry.
 */
export async function pictureTiles(kind) {
  if (kind === 'sat') {
    const src = satelliteSource();
    if (src.id === 'google') {
      try {
        const s = await googleSession();
        return {
          url: (z, x, y) => `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(s)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`,
          maxZoom: 19,
          credit: 'Imagery © Google',
        };
      } catch {
        googleBroken = true;
        return pictureTiles('sat');
      }
    }
    if (src.id === 'esri') {
      return {
        url: (z, x, y) => `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(ARCGIS_API_KEY)}`,
        maxZoom: 18,
        credit: 'Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      };
    }
    return {
      url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_YEAR}_3857/default/g/${z}/${y}/${x}.jpg`,
      maxZoom: 16,
      credit: `Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${EOX_YEAR})`,
    };
  }
  return {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    maxZoom: 19,
    credit: '© OpenStreetMap contributors',
  };
}

/**
 * Tile layer for 'map' (street map) or 'sat' (satellite). `compact`: shorter credits (mini map).
 * A satellite layer may fire 'sourcefail' when its imagery cannot be used; then ask for a new one.
 */
export function baseLayer(kind, compact = false) {
  if (kind === 'sat') {
    const src = satelliteSource();
    if (src.id === 'google') return new GoogleLayer({ maxZoom: 20, maxNativeZoom: 19 });
    if (src.id === 'esri') {
      return L.tileLayer(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ARCGIS_API_KEY)}`, {
        maxZoom: 19,
        maxNativeZoom: 18,
        attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      });
    }
    return L.tileLayer(`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`, {
      maxZoom: 19,
      maxNativeZoom: 16,
      attribution: compact
        ? `<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> · EOX IT Services GmbH · Copernicus Sentinel data ${EOX_YEAR}`
        : `<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${EOX_YEAR})`,
    });
  }
  return L.tileLayer(OSM, { maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap' });
}
