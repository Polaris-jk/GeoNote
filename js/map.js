// Leaflet map with geological station symbols.
// Map tiles you have viewed while online are kept for offline use by the service worker.

/* global L */
import { esc } from './util.js';
import { az3, fmtPlane, hasMeasurement } from './geomath.js';
import { lithName } from './vocab.js';
import { colorFor } from './rockcolors.js';
import { toUTM, gridRef } from './utm.js';
import * as store from './store.js';
import { baseLayer, satelliteSource } from './basemaps.js';
import { toast } from './ui.js';
import * as offline from './offlinemap.js';
import { t } from './i18n.js';

const THAILAND = [15.5, 101.2];

const firstMeas = (st) => (st.measurements || []).find((m) => hasMeasurement(m) && m.strike != null) || null;

function stationIcon(st) {
  const m = firstMeas(st);
  const lith = lithName(st);
  const g = st.location ? gridRef(toUTM(st.location.lat, st.location.lon, store.zoneLock())) : null;
  // pin in the rock's colour; the strike/dip symbol, when measured, is drawn over it
  let sym = `<i class="rk" style="background:${colorFor(st)}"></i>`;
  if (m) {
    const dd = ((m.dipdir ?? m.strike + 90) * Math.PI) / 180;
    const x = 15 + Math.sin(dd) * 15.5;
    const y = 15 - Math.cos(dd) * 15.5;
    sym += `<svg class="sd" viewBox="0 0 30 30" style="transform:rotate(${m.strike}deg)"><path d="M15 2.5v25M15 15h7.5"/></svg>`
      + (m.dip != null ? `<b class="sd-dip" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${Math.round(m.dip)}</b>` : '');
  }
  return L.divIcon({
    className: 'st-icon',
    // label: station, 6-figure grid reference, rock
    html: `${sym}<span class="st-lbl">${esc(st.code)}${g ? `<b class="gr">${g.gr}</b>` : ''}${lith ? `<small>${esc(lith)}</small>` : ''}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

function popupHTML(st) {
  const m = firstMeas(st);
  const plane = m ? fmtPlane(m) : null;
  const lith = lithName(st);
  return `<div class="pp">
    <b>${esc(st.code)}</b>
    <span>${lith ? esc(lith) : 'No lithology yet'}</span>
    ${plane ? `<span class="mono">${plane}${m.dipdir != null ? ` → ${az3(m.dipdir)}` : ''}</span>` : ''}
    <button type="button" class="btn sm" data-open>Open station</button>
  </div>`;
}

export function createMap(el, { interactive = true } = {}) {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    dragging: interactive,
    touchZoom: interactive,
    doubleClickZoom: interactive,
    scrollWheelZoom: interactive,
    boxZoom: false,
    keyboard: interactive,
    tap: false,
    zoomSnap: 0.25,
    fadeAnimation: false,
  }).setView(THAILAND, 6);
  map.attributionControl.setPrefix('');
  // 'map' = OpenStreetMap online, 'sat' = satellite, 'offline' = region maps kept on the phone
  const norm = (k) => (k === 'map' || k === 'offline' ? k : 'sat');
  let chosen = norm(store.getSettings().basemap);
  let baseKind = null;
  let base = null;
  let job = 0;
  const show = (layer, kind) => {
    layer.addTo(map);
    layer.bringToBack?.();
    if (base) map.removeLayer(base);
    base = layer;
    baseKind = kind;
    el.classList.toggle('is-sat', kind === 'sat');
    el.classList.toggle('is-offline', kind === 'offline');
  };
  // satellite imagery that turns out to be unusable (e.g. a wrong key) is replaced by the next source
  function useOnline(kind) {
    const next = baseLayer(kind, !interactive);
    next.on('sourcefail', (e) => {
      if (base !== next) return;
      const alt = satelliteSource();
      toast(t(`ใช้ภาพดาวเทียม Google ไม่ได้ (${e.error?.message || 'error'}) ใช้ ${alt.name} แทน`, `Google satellite imagery is not available (${e.error?.message || 'error'}). Using ${alt.name} instead.`), 5000);
      useOnline(kind);
    });
    show(next, kind);
  }
  /** Show the chosen map; with no internet, the offline map is used instead when it is on the phone. */
  async function refreshBase(announce = false, force = false) {
    const my = ++job;
    const have = await offline.hasAny();
    if (my !== job) return;
    let kind = chosen;
    if (kind !== 'offline' && !navigator.onLine && have) kind = 'offline';
    if (kind === 'offline' && !have) {
      if (announce) toast(t('ยังไม่มีแผนที่ออฟไลน์ในเครื่อง ดาวน์โหลดได้ที่ Settings → ข้อมูลออฟไลน์', 'No offline map on this phone yet. Download one in Settings → Offline data.'), 4000);
      kind = 'map';
    }
    if (kind === baseKind && !force) return;
    if (kind === 'offline') {
      try {
        const { group, background } = await offline.layer();
        if (my !== job) return;
        if (background) el.style.setProperty('--offline-bg', background);
        show(group, 'offline');
        if (announce && chosen !== 'offline') toast(t('ไม่มีเน็ต ใช้แผนที่ออฟไลน์แทน', 'No internet: showing the offline map'));
      } catch (err) {
        toast(t(`เปิดแผนที่ออฟไลน์ไม่ได้ (${err.message})`, `Cannot open the offline map (${err.message})`), 4000);
        if (!base) useOnline('map');
      }
      return;
    }
    useOnline(kind);
  }
  const onNet = () => refreshBase(true);
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  // a region map was added or removed: redraw when the offline map is (or should be) on screen
  const offUnsub = offline.subscribe(({ downloading }) => {
    if (!downloading && (baseKind === 'offline' || chosen === 'offline' || !navigator.onLine)) refreshBase(false, true);
  });
  refreshBase(false);
  if (interactive) L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  const stationLayer = L.layerGroup().addTo(map);
  let bounds = null;
  let me = null;
  let meAcc = null;
  let centered = false;

  return {
    map,
    setStations(list, onOpen) {
      stationLayer.clearLayers();
      const pts = [];
      for (const st of list) {
        if (!st.location) continue;
        const ll = [st.location.lat, st.location.lon];
        pts.push(ll);
        const mk = L.marker(ll, { icon: stationIcon(st), keyboard: false, riseOnHover: true });
        if (onOpen) {
          mk.bindPopup(popupHTML(st), { closeButton: false, className: 'geo-popup', autoPanPadding: [24, 24] });
          mk.on('popupopen', (e) => {
            e.popup.getElement()?.querySelector('[data-open]')?.addEventListener('click', () => onOpen(st));
          });
        }
        mk.addTo(stationLayer);
      }
      // join the stations in the order they were recorded
      const route = list.filter((st) => st.location).sort((x, y) => x.createdAt - y.createdAt)
        .map((st) => [st.location.lat, st.location.lon]);
      if (route.length > 1) {
        // smoothFactor 0: keep every station as a corner of the line
        L.polyline(route, { className: 'route-halo', interactive: false, smoothFactor: 0 }).addTo(stationLayer);
        L.polyline(route, { className: 'route-line', interactive: false, smoothFactor: 0 }).addTo(stationLayer);
      }
      bounds = pts.length ? L.latLngBounds(pts) : null;
    },
    hasStations: () => !!bounds,
    fitStations(maxZoom = 17) {
      if (!bounds) return;
      // keep pins and their labels (to the right of each pin) clear of the buttons on the right
      if (interactive) map.fitBounds(bounds.pad(0.08), { maxZoom, animate: false, paddingTopLeft: [28, 70], paddingBottomRight: [140, 46] });
      else map.fitBounds(bounds.pad(0.3), { maxZoom, animate: false });
    },
    /** Show the live position. `follow` keeps it centred (mini map). */
    setPosition(fix, { follow = false } = {}) {
      const ll = [fix.lat, fix.lon];
      if (!me) {
        meAcc = L.circle(ll, { radius: fix.acc || 0, className: 'me-acc', interactive: false }).addTo(map);
        me = L.circleMarker(ll, { radius: 7, className: 'me-dot', interactive: false }).addTo(map);
      } else {
        me.setLatLng(ll);
        meAcc.setLatLng(ll).setRadius(fix.acc || 0);
      }
      if (follow) {
        if (!centered) { map.setView(ll, 17, { animate: false }); centered = true; }
        else map.panTo(ll, { animate: false });
      }
    },
    centerOn(fix, zoom = 17) {
      map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), zoom), { animate: false });
    },
    /** Switch to the street map ('map'), satellite imagery ('sat') or the offline map ('offline'). */
    setBasemap(kind) {
      chosen = norm(kind);
      return refreshBase(true);
    },
    /** What the user picked. */
    basemap: () => chosen,
    /** What is on screen (differs from basemap() when the offline map stands in for no internet). */
    shownBasemap: () => baseKind,
    invalidate() { map.invalidateSize(false); },
    destroy() {
      job++;
      offUnsub();
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      map.remove();
    },
  };
}
