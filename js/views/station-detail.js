// Station — read-only page for looking at what was recorded and the photos.
// Nothing here can change or delete data; editing starts only from the แก้ไข button.

import * as store from '../store.js';
import { coordMode, coordRows } from '../coords.js';
import { lithInfo, lithName, weatheringLabel, STRUCTURE_TYPES } from '../vocab.js';
import { icon, strikeDipSymbol } from '../icons.js';
import { setHeader } from '../ui.js';
import { openGallery } from '../gallery.js';
import { esc, pad, fmtClock, fmtDay } from '../util.js';
import { az3, fmtPlane, hasMeasurement, accClass, fmtAcc } from '../geomath.js';
import { t, isEn } from '../i18n.js';
import { pointType, isAutoType, typeName, shapeSVG } from '../pointtype.js';
import { colorFor } from '../rockcolors.js';

const structTH = (en) => STRUCTURE_TYPES.find(([e]) => e === en)?.[1] || '';

export async function render(root, ctx, id) {
  const back = ctx.prev && !ctx.prev.startsWith(`#/station/${id}`) ? ctx.prev : '#/stations';
  setHeader({ left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="${t('กลับ', 'Back')}">${icon('back')}</button>` });
  document.getElementById('hdrBack').onclick = () => { location.hash = back.startsWith('#/station/') ? '#/stations' : back; };

  const [st, list] = await Promise.all([store.getStation(id), store.listStations()]);
  if (!ctx.alive()) return;
  if (!st) {
    root.innerHTML = `<div class="empty"><p>${t('ไม่พบ Station นี้ อาจถูกลบไปแล้ว', 'Station not found. It may have been deleted.')}</p><a class="btn" href="#/stations">${t('ดูรายการ Station', 'See all stations')}</a></div>`;
    return;
  }

  setHeader({
    left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="${t('กลับ', 'Back')}">${icon('back')}</button>`,
    title: `<div class="hdr-st"><span>Station</span><b>${String(st.number).padStart(3, '0')}</b></div>`,
    right: `<a class="hdr-btn" href="#/station/${st.id}/edit">${icon('edit')}${t('แก้ไข', 'Edit')}</a>`,
  });
  document.getElementById('hdrBack').onclick = () => { location.hash = back.startsWith('#/station/') ? '#/stations' : back; };

  const lith = lithName(st);
  const info = lithInfo(lith);
  const L = st.location;
  const meas = (st.measurements || []).filter(hasMeasurement);
  const ordered = [...list].sort((a, b) => a.number - b.number);
  const idx = ordered.findIndex((s) => s.id === st.id);
  const prev = ordered[idx - 1];
  const next = ordered[idx + 1];

  const locRows = L
    ? [...coordRows(L, coordMode()).map(([k, v, c]) => [k, esc(v), c]),
      ['Accuracy', `<span class="q-${accClass(L.acc)}">±${fmtAcc(L.acc)}<span class="u">m</span></span>`],
      ['Altitude', L.alt != null ? `${Math.round(L.alt)}<span class="u">m</span>` : '—']]
    : [];

  root.innerHTML = `<div class="screen page detail-screen">
    <header class="dt-hero">
      <p class="dt-code">${esc(st.code)}${st.status === 'draft' ? '<em class="draft">Draft</em>' : ''}<span class="kind-tag">${shapeSVG(pointType(st) === 'station' ? 'square' : 'circle', colorFor(st), 'pt-shape sm')}${typeName(pointType(st))}${isAutoType(st) ? `<small>${t('อัตโนมัติ', 'auto')}</small>` : ''}</span></p>
      <h1 class="dt-lith">${lith ? esc(lith) : `<span class="muted">${t('ยังไม่ระบุชนิดหิน', 'No rock type yet')}</span>`}${info && info.th !== lith && !isEn() ? `<i>${esc(info.th)}</i>` : ''}</h1>
      <p class="dt-time">${t(`บันทึกเมื่อ ${fmtClock(st.createdAt)} น. ${fmtDay(st.createdAt)}`, `Recorded ${fmtClock(st.createdAt)}, ${fmtDay(st.createdAt)}`)}</p>
    </header>

    <section class="loc-panel">
      <h2 class="sec-h">Location ${L ? `<span class="fix-tag q-${accClass(L.acc)}">${L.method === 'average' ? t(`เฉลี่ย ${L.n} ค่า`, `average of ${L.n}`) : t('ค่าเดียว', 'single fix')}</span>` : ''}</h2>
      ${L ? `<p class="loc-sys">${coordMode() === 'utm' ? 'Grid Ref / UTM WGS84' : 'Lat/Long WGS84'}</p>
        <dl class="loc-rows">${locRows.map(([k, v, c]) => `<div${c ? ` class="${c}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
      : `<p class="sec-empty">${t('Station นี้ยังไม่มีพิกัด', 'This station has no coordinates yet')}</p>`}
    </section>

    ${st.weathering || st.color ? `<section class="sec">
      <h2 class="sec-h">Rock / outcrop</h2>
      ${st.weathering ? `<p class="kv"><span>Weathering</span><b>${esc(weatheringLabel(st.weathering))}</b></p>` : ''}
      ${st.color ? `<p class="kv"><span>Color</span><b>${esc(st.color)}</b></p>` : ''}
    </section>` : ''}

    ${meas.length ? `<section class="sec">
      <h2 class="sec-h">Structure <span class="sec-note">right-hand rule</span></h2>
      <ul class="dt-meas">${meas.map((m) => `<li>
        ${strikeDipSymbol(m.strike ?? 0, `sdsym live${m.strike == null ? ' idle' : ''}`)}
        <span class="dt-mtype">${esc(m.type || '')}${isEn() ? '' : `<i>${esc(structTH(m.type))}</i>`}${m.src === 'sensor' ? `<em class="src-tag">${icon('clino')}${t('เซนเซอร์', 'sensor')}</em>` : ''}</span>
        <span class="dt-plane mono">${fmtPlane(m) || '—'}</span>
        <span class="dt-dd mono">${m.dipdir != null ? `→ ${az3(m.dipdir)}` : ''}</span>
      </li>`).join('')}</ul>
    </section>` : ''}

    ${(st.samples || []).length ? `<section class="sec">
      <h2 class="sec-h">Samples</h2>
      <ul class="dt-samples">${st.samples.map((s) => `<li><b class="mono">${esc(s.id)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ''}</li>`).join('')}</ul>
    </section>` : ''}

    ${(st.photoIds || []).length ? `<section class="sec">
      <h2 class="sec-h">Photos <span class="sec-note">${t(`${st.photoIds.length} รูป`, `${st.photoIds.length}`)}</span></h2>
      <div class="photo-grid" id="photoGrid"></div>
    </section>` : ''}

    ${st.notes?.trim() ? `<section class="sec">
      <h2 class="sec-h">Notes</h2>
      <p class="dt-notes">${esc(st.notes)}</p>
    </section>` : ''}

    ${st.updatedAt && st.updatedAt - st.createdAt > 60000 ? `<p class="hint dt-edited">${t(`แก้ไขล่าสุด ${fmtClock(st.updatedAt)} น. ${fmtDay(st.updatedAt)}`, `Last edited ${fmtClock(st.updatedAt)}, ${fmtDay(st.updatedAt)}`)}</p>` : ''}
  </div>
  <nav class="cta dt-nav" aria-label="${t('Station ก่อนหน้าและถัดไป', 'Previous and next station')}">
    ${prev ? `<a class="btn-secondary" href="#/station/${prev.id}">${icon('back')}<span>${esc(prev.code)}</span></a>` : '<span></span>'}
    ${next ? `<a class="btn-secondary next" href="#/station/${next.id}"><span>${esc(next.code)}</span>${icon('back')}</a>` : '<span></span>'}
  </nav>`;

  // thumbnails
  const urls = [];
  const grid = root.querySelector('#photoGrid');
  if (grid) {
    const metas = await store.listPhotos(st);
    if (!ctx.alive()) return;
    grid.innerHTML = metas.map((p, i) => {
      const url = URL.createObjectURL(new Blob([p.thumb], { type: 'image/jpeg' }));
      urls.push(url);
      return `<button type="button" class="ph" data-photo-id="${p.id}" aria-label="${t(`ดูรูปที่ ${i + 1}`, `View photo ${i + 1}`)}"><img src="${url}" alt=""><span>${pad(i + 1)}</span></button>`;
    }).join('');
    grid.addEventListener('click', (e) => {
      const ph = e.target.closest('[data-photo-id]');
      if (ph) openGallery(st, ph.dataset.photoId);
    });
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
