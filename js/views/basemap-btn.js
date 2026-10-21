// The map button on the GPS and Map screens: pick one of three background maps.
//   แผนที่      OpenStreetMap online (towns, roads)
//   ดาวเทียม    satellite imagery (online)
//   ออฟไลน์     region maps kept on the phone, also used automatically when there is no internet
// The choice is remembered and shared by both screens. The same sheet downloads the ground heights
// (DEM) of the area on screen for cross sections with no internet.

import * as store from '../store.js';
import { satelliteSource } from '../basemaps.js';
import * as offline from '../offlinemap.js';
import * as dem from '../dem.js';
import { icon } from '../icons.js';
import { toast, openOverlay } from '../ui.js';
import { REGIONS, regionAt, regionName } from '../regions.js';
import { downloadRegion, downloadDem } from './offline-dl.js';
import { fmtSize } from '../util.js';
import { t } from '../i18n.js';

/** The map's view as a lat/lon box, widened to at least about 12 × 12 km around its middle. */
function demBox(map) {
  const b = map.getBounds();
  const c = map.getCenter();
  const dLat = 6000 / 110574;
  const dLon = 6000 / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return {
    south: Math.min(b.getSouth(), c.lat - dLat), north: Math.max(b.getNorth(), c.lat + dLat),
    west: Math.min(b.getWest(), c.lng - dLon), east: Math.max(b.getEast(), c.lng + dLon),
  };
}

const LABEL = {
  get map() { return t('แผนที่', 'Map'); },
  get sat() { return t('ดาวเทียม', 'Satellite'); },
  get offline() { return t('ออฟไลน์', 'Offline'); },
};
const ICON = { map: 'map', sat: 'satellite', offline: 'download' };

export function wireBasemapButton(btn, m) {
  if (!btn) return;
  const paint = () => {
    const k = m.shownBasemap?.() || m.basemap();
    btn.innerHTML = `${icon(ICON[k] || 'map')}<span>${LABEL[k] || LABEL.map}</span>`;
    btn.setAttribute('aria-label', t(`แผนที่พื้นหลัง: ${LABEL[k]} แตะเพื่อเปลี่ยน`, `Background map: ${LABEL[k]}. Tap to change`));
    btn.classList.toggle('on', k !== 'map');
  };
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const have = await offline.stored();
    const demInfo = await dem.storedInfo();
    const c = m.map.getCenter();
    const here = regionAt(c.lat, c.lng);
    const cur = m.basemap();
    const sat = satelliteSource();
    const names = REGIONS.filter((r) => have.has(r.id)).map((r) => regionName(r));
    const hereMissing = here && !have.has(here.id);
    const offDesc = have.size
      ? t(`ในเครื่อง: ${names.join(', ')}${hereMissing ? ` · ${regionName(here)}ยังไม่มี` : ''}`, `On this phone: ${names.join(', ')}${hereMissing ? ` · ${regionName(here)} not yet` : ''}`)
      : t(`ยังไม่มีในเครื่อง แตะเพื่อดาวน์โหลด${regionName(here || REGIONS[0])} (ต่อ Wi-Fi จะดีกว่า)`, `Not on this phone yet. Tap to download the ${regionName(here || REGIONS[0])} (Wi-Fi recommended)`);
    const opt = (k, title, desc) => `<button type="button" class="x-item base-opt" data-b="${k}" aria-pressed="${k === cur}">
      <b>${icon(ICON[k])} ${title}${k === cur ? ' ✓' : ''}</b><span>${desc}</span></button>`;
    openOverlay(`<div class="sheet" role="dialog" aria-label="${t('แผนที่พื้นหลัง', 'Background map')}">
        <div class="sheet-grip"></div>
        <h3>${t('แผนที่พื้นหลัง', 'Background map')}</h3>
        <p class="sheet-sub">${t('ไม่มีเน็ตเมื่อไร แอปใช้แผนที่ออฟไลน์ให้เอง', 'With no internet the app switches to the offline map by itself')}</p>
        <div class="x-list">
          ${opt('map', t('แผนที่ OpenStreetMap', 'OpenStreetMap'), t('ถนน หมู่บ้าน เมือง ต้องต่อเน็ต (บริเวณที่เคยเปิดดูจะจำไว้บางส่วน)', 'Roads, villages, towns. Needs internet (places you have viewed are partly kept)'))}
          ${opt('sat', t('ภาพถ่ายดาวเทียม', 'Satellite imagery'), t(`${sat.name} (${sat.res}) ต้องต่อเน็ต`, `${sat.name} (${sat.res}). Needs internet`))}
          ${opt('offline', t('แผนที่ออฟไลน์', 'Offline map'), offDesc)}
        </div>
        ${hereMissing && have.size ? `<button type="button" class="btn block" data-dl="${here.id}">${icon('download')}${t(`ดาวน์โหลดแผนที่${regionName(here)}`, `Download the ${regionName(here)} map`)}</button>` : ''}
        <div class="dem-box">
          <b>${icon('section')}${t('ความสูงพื้นดิน (DEM) สำหรับภาพตัดขวาง', 'Ground heights (DEM) for cross sections')}</b>
          <span>${demInfo.count ? t(`ในเครื่อง ${fmtSize(demInfo.bytes)}`, `On this phone: ${fmtSize(demInfo.bytes)}`) : t('ยังไม่มีในเครื่อง', 'None on this phone yet')} · ${t('โหลดบริเวณที่เห็นบนจอไว้ก่อนออกสนาม ภาพตัดขวางจะใช้ได้แม้ไม่มีเน็ต', 'Download the area on screen before fieldwork and cross sections work with no internet')}</span>
          <button type="button" class="btn block" data-dem>${icon('download')}${t('ดาวน์โหลดความสูงบริเวณนี้', 'Download heights for this area')}</button>
        </div>
        <a class="btn block" href="#/settings" data-close>${t('ข้อมูลออฟไลน์ทุกภาค (Settings)', 'Offline data for every region (Settings)')}</a>
      </div>`, {
      onClick: async (ev, close) => {
        const dl = ev.target.closest('[data-dl]');
        if (dl) { close(); await downloadRegion(dl.dataset.dl, { rocks: false }); return; }
        if (ev.target.closest('[data-dem]')) { const box = demBox(m.map); close(); await downloadDem(box); return; }
        const b = ev.target.closest('[data-b]');
        if (!b) return;
        const kind = b.dataset.b;
        close();
        if (kind === 'offline' && !have.size) {
          const ok = await downloadRegion((here || REGIONS[0]).id, { rocks: false });
          if (!ok) return;
        }
        store.updateSettings({ basemap: kind });
        await m.setBasemap(kind);
        paint();
        if (kind === 'sat') toast(t(`ภาพดาวเทียม ${sat.name} (${sat.res}) ต้องต่อเน็ต`, `Satellite imagery ${sat.name} (${sat.res}) needs internet`));
      },
    });
  });
  // the map may switch to the offline map by itself when the internet drops
  const repaint = () => {
    if (!btn.isConnected) { window.removeEventListener('online', repaint); window.removeEventListener('offline', repaint); return; }
    setTimeout(paint, 400);
  };
  window.addEventListener('online', repaint);
  window.addEventListener('offline', repaint);
  paint();
}
