// Map — every station with its strike/dip symbol. Shows your last known position;
// the locate button switches the GPS on once and off again.

import * as gps from '../gps.js';
import * as store from '../store.js';
import { createMap } from '../map.js';
import { wireBasemapButton } from './basemap-btn.js';
import { icon } from '../icons.js';
import { mainHeader, toast } from '../ui.js';
import { accClass, fmtAcc } from '../geomath.js';
import { fixAge } from '../coords.js';
import { ensureColors, legend } from '../rockcolors.js';
import { esc } from '../util.js';
import * as geol from '../geology.js';
import { regionAt, regionName } from '../regions.js';
import { downloadRegion } from './offline-dl.js';
import { t } from '../i18n.js';
import { walkEnds, shapeOf, shapeName, shapeSVG } from '../pointtype.js';

export async function render(root, ctx) {
  mainHeader();
  root.innerHTML = `<div class="map-screen">
    <div class="bigmap" id="bigmap"></div>
    <div class="gps-chip map-chip" id="mapChip"></div>
    <div class="map-legend hidden" id="mapLegend"></div>
    <button type="button" class="geol-dl hidden" id="geolDl"></button>
    <div class="map-fabs">
      <button type="button" class="fab fab-geol" id="fabGeol" aria-label="${t('ชั้นหน่วยหิน', 'Rock units layer')}"></button>
      <button type="button" class="fab fab-base" id="fabBase"></button>
      <a class="fab" href="#/summary" aria-label="${t('สร้างแผนที่สรุปเป็นรูป', 'Make a summary map picture')}">${icon('image')}</a>
      <button type="button" class="fab" id="fabFit" aria-label="${t('แสดงทุก Station', 'Show all stations')}">${icon('fit')}</button>
      <button type="button" class="fab" id="fabMe" aria-label="${t('หาตำแหน่งปัจจุบัน', 'Find my position')}">${icon('locate')}</button>
    </div>
  </div>`;

  const m = createMap(root.querySelector('#bigmap'), { interactive: true });
  const list = await store.listStations();
  await ensureColors(list);
  if (!ctx.alive()) { m.destroy(); return; }
  m.setStations(list, (st) => { location.hash = `#/station/${st.id}`; });
  wireBasemapButton(root.querySelector('#fabBase'), m);

  // legend: what each pin colour means
  const lg = root.querySelector('#mapLegend');
  const entries = legend(list.filter((s) => s.location));
  // point symbols in use: square station, circle check point, triangle first/last of the walk
  const ends = walkEnds(list);
  const used = new Set(list.filter((s) => s.location).map((s) => shapeOf(s, ends)));
  const kinds = ['square', 'circle', 'tri'].filter((k) => used.has(k));
  if (entries.length) {
    let open = store.getSettings().legendOpen !== false;
    const paint = () => {
      lg.classList.toggle('closed', !open);
      lg.innerHTML = `<button type="button" class="lg-head" aria-expanded="${open}">${t('สัญลักษณ์สีหิน', 'Rock colours')}<span>${open ? '−' : '+'}</span></button>
        ${open ? `<ul>${entries.map((e) => `<li><i style="background:${e.color}"></i><span><b>${esc(e.name)}</b>${e.th ? ` ${esc(e.th)}` : ''}<small>${esc(e.note)}</small></span><em>${e.n}</em></li>`).join('')}</ul>
          <p class="lg-kinds">${kinds.map((k) => `<span>${shapeSVG(k, '#ffffff', 'pt-shape sm')}${esc(shapeName(k))}</span>`).join('')}</p>` : ''}`;
    };
    lg.classList.remove('hidden');
    paint();
    lg.addEventListener('click', (e) => {
      if (!e.target.closest('.lg-head')) return;
      open = !open;
      store.updateSettings({ legendOpen: open });
      paint();
    });
    L.DomEvent?.disableClickPropagation?.(lg);
    L.DomEvent?.disableScrollPropagation?.(lg);
  }
  if (m.hasStations()) m.fitStations();
  const geolOff = wireGeology(root, m);

  const chip = root.querySelector('#mapChip');
  const fab = root.querySelector('#fabMe');
  let centred = m.hasStations();
  const unsub = gps.subscribe((s) => {
    const live = s.status === 'locating' ? s.progress?.best : null;
    const f = live || s.fix;
    if (f) {
      m.setPosition(f);
      if (!centred) { m.centerOn(f, 16); centred = true; }
    }
    fab.classList.toggle('busy', s.status === 'locating');
    if (s.status === 'locating') {
      chip.innerHTML = `<i class="dot pulse q-${live ? accClass(live.acc) : 'fair'}"></i>${live ? t(`กำลังหาพิกัด ±${fmtAcc(live.acc)} m`, `Locating ±${fmtAcc(live.acc)} m`) : t('กำลังหาสัญญาณ GPS', 'Waiting for GPS signal')}`;
    } else if (s.fix) {
      chip.innerHTML = `<i class="dot"></i>${fixAge(s.fix)}`;
    } else {
      chip.innerHTML = `<i class="dot"></i>${t('แตะปุ่มตำแหน่งเพื่อหาพิกัด', 'Tap the location button to get a fix')}`;
    }
  });

  const abort = new AbortController();
  fab.onclick = async () => {
    if (gps.isRunning()) { gps.stopNow(); return; }
    try {
      const f = await gps.locate({ target: Number(store.getSettings().gpsTarget) || 5, signal: abort.signal });
      m.centerOn(f, 17);
      toast(t(`ได้พิกัดแล้ว ±${fmtAcc(f.acc)} m ปิด GPS แล้ว`, `Fix ±${fmtAcc(f.acc)} m. GPS is off again`));
    } catch (err) {
      if (err.name !== 'AbortError') toast(gps.GPS_ERRORS[err.message] || t(`GPS ผิดพลาด: ${err.message}`, `GPS error: ${err.message}`), 4000);
    }
  };
  root.querySelector('#fabFit').onclick = () => {
    if (m.hasStations()) m.fitStations();
    else toast(t('ยังไม่มี Station บนแผนที่', 'No stations on the map yet'));
  };

  return () => { abort.abort(); unsub(); geolOff(); m.destroy(); };
}

// ---------- rock units (DMR 1:250,000) ----------
function wireGeology(root, m) {
  const map = m.map;
  const btn = root.querySelector('#fabGeol');
  const dl = root.querySelector('#geolDl');
  let on = store.getSettings().geolLayer === true;
  let lyr = null;
  let busy = false;
  let missing = null; // region in view whose rock units are not on the phone

  const paint = () => {
    btn.innerHTML = `${icon('layers')}<span>${t('หน่วยหิน', 'Rocks')}</span>`;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  // offer the region in the middle of the map when its rock units are not on the phone yet
  const checkRegion = async () => {
    const c = map.getCenter();
    const r = on && map.getZoom() >= 7 ? regionAt(c.lat, c.lng) : null;
    missing = r && !(await geol.hasRegion(r.id)) ? r : null;
    if (!busy) dl.innerHTML = missing ? `${icon('download')}<span>${t(`โหลดหน่วยหิน${regionName(missing)}`, `Get ${regionName(missing)} rock units`)}</span>` : '';
    dl.classList.toggle('hidden', !missing && !busy);
  };
  const draw = () => {
    if (lyr) { map.removeLayer(lyr); lyr = null; }
    if (!on || !geol.hasData()) return;
    lyr = geol.layer(map.getBounds().pad(0.5)).addTo(map);
  };
  const onMove = () => { if (on) { draw(); checkRegion(); } };
  const onTap = (e) => {
    if (!on) return;
    const f = geol.unitAt(e.latlng.lat, e.latlng.lng);
    if (!f) {
      const r = regionAt(e.latlng.lat, e.latlng.lng);
      toast(r && missing?.id === r.id ? t(`ยังไม่มีหน่วยหิน${regionName(r)}ในเครื่อง แตะ โหลดหน่วยหิน${regionName(r)}`, `${regionName(r)} rock units are not on this phone yet. Tap Get ${regionName(r)} rock units`) : t('ไม่มีข้อมูลหน่วยหินตรงนี้', 'No rock unit data here'), 3000);
      return;
    }
    const d = geol.describe(f);
    L.popup({ closeButton: false, className: 'geo-popup', autoPanPadding: [24, 24] })
      .setLatLng(e.latlng)
      .setContent(`<div class="pp"><b><i class="geol-sw" style="background:${geol.colorOf(f)}"></i>${esc(d.sym || t('หน่วยหิน', 'Rock unit'))}</b>
        ${d.name ? `<span>${esc(d.name)}</span>` : ''}${d.age ? `<span>${esc(d.age)}</span>` : ''}${d.rock ? `<span class="geol-rock">${esc(d.rock)}</span>` : ''}
        <small class="geol-src">${geol.attribution()}</small></div>`)
      .openOn(map);
  };

  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    on = !on;
    store.updateSettings({ geolLayer: on });
    paint();
    if (on) {
      await geol.load();
      toast(geol.hasData() ? t('แตะบนแผนที่เพื่อดูหน่วยหิน', 'Tap the map to see the rock unit') : t('ยังไม่มีข้อมูลหน่วยหินในแอป', 'No rock unit data in the app yet'), 2500);
    }
    draw();
    checkRegion();
  });

  dl.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (busy || !missing) return;
    const r = missing;
    busy = true;
    dl.classList.add('busy');
    dl.innerHTML = `${icon('download')}<span>${t(`กำลังโหลดหน่วยหิน${regionName(r)}…`, `Downloading ${regionName(r)} rock units…`)}</span>`;
    try {
      await downloadRegion(r.id, { map: false });
      draw();
    } finally {
      busy = false;
      dl.classList.remove('busy');
      checkRegion();
    }
  });
  L.DomEvent?.disableClickPropagation?.(dl);

  map.on('moveend', onMove);
  map.on('click', onTap);
  paint();
  if (on) geol.load().then(() => { draw(); checkRegion(); });
  return () => { map.off('moveend', onMove); map.off('click', onTap); };
}
