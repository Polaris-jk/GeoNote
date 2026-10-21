// Stations — the notebook index for the current project.
// Tap a row to read it; swipe a row left for Edit / Delete; Export, the summary map and the
// cross section live here.

import * as store from '../store.js';
import { icon, strikeDipSymbol } from '../icons.js';
import { mainHeader, toast } from '../ui.js';
import { enableSwipe } from '../swipe.js';
import { openExportSheet } from './export-sheet.js';
import { esc, fmtClock, fmtDay } from '../util.js';
import { fmtPlane, hasMeasurement } from '../geomath.js';
import { lithInfo, lithName } from '../vocab.js';
import { t, isEn } from '../i18n.js';
import { walkEnds, shapeOf, shapeName, shapeSVG } from '../pointtype.js';
import { colorFor } from '../rockcolors.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function row(st, ends) {
  const m = (st.measurements || []).find((x) => hasMeasurement(x) && x.strike != null);
  const lith = lithName(st);
  const th = lithInfo(st.lithology)?.th;
  const when = st.createdAt;
  const nS = (st.samples || []).length;
  const nP = (st.photoIds || []).length;
  return `<li class="sw-item" data-id="${st.id}">
    <div class="sw-actions">
      <button type="button" class="sw-edit" data-swipe-act="edit">${icon('edit')}${t('แก้ไข', 'Edit')}</button>
      <button type="button" class="sw-del" data-swipe-act="delete">${icon('trash')}${t('ลบ', 'Delete')}</button>
    </div>
    <a class="st-row sw-front" href="#/station/${st.id}" draggable="false">
      <span class="st-thumb${nP ? '' : ' none'}" aria-hidden="true">${nP ? '' : icon('photo')}</span>
      <span class="st-num">${String(st.number).padStart(3, '0')}</span>
      <span class="st-body">
        <span class="st-lith">${st.location ? `<span class="st-shape" title="${esc(shapeName(shapeOf(st, ends)))}">${shapeSVG(shapeOf(st, ends), colorFor(st), 'pt-shape sm')}</span>` : ''}${lith ? esc(lith) : `<span class="muted">${t('ยังไม่ระบุชนิดหิน', 'No rock type yet')}</span>`}${th && th !== lith && !isEn() ? `<i>${esc(th)}</i>` : ''}</span>
        <span class="st-meta">
          ${m ? `<span class="st-plane">${strikeDipSymbol(m.strike)}${fmtPlane(m) || ''}</span>` : ''}
          ${nS ? `<span title="${plural(nS, 'sample')}">${icon('sample')}${nS}</span>` : ''}
          ${nP ? `<span title="${plural(nP, 'photo')}">${icon('photo')}${nP}</span>` : ''}
          ${!st.location ? `<span class="warn">${t('ไม่มีพิกัด', 'No coordinates')}</span>` : ''}
        </span>
      </span>
      <span class="st-side">
        <span>${fmtClock(when)}</span>
        <small>${fmtDay(when, false)}</small>
        ${st.status === 'draft' ? '<em class="draft">Draft</em>' : ''}
      </span>
    </a>
  </li>`;
}

export async function render(root, ctx) {
  mainHeader();
  root.innerHTML = '<div class="screen"><p class="loading"><i class="spinner"></i></p></div>';
  let detachSwipe = null;
  let thumbUrls = [];
  const dropThumbs = () => { thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls = []; };

  /** First photo of each station as a small square in front of its number. */
  async function loadThumbs(list) {
    for (const st of list) {
      if (!(st.photoIds || []).length) continue;
      const t = await store.firstThumb(st).catch(() => null);
      if (!t || !ctx.alive()) continue;
      const slot = root.querySelector(`.sw-item[data-id="${st.id}"] .st-thumb`);
      if (!slot) continue;
      const url = URL.createObjectURL(new Blob([t.buf], { type: t.type }));
      thumbUrls.push(url);
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.onload = () => slot.classList.add('ready');
      img.src = url;
      slot.appendChild(img);
    }
  }

  async function paint() {
    const list = await store.listStations();
    if (!ctx.alive()) return;
    const project = store.getProject();
    const ends = walkEnds(list); // first and last point of the walk: triangles
    const samples = list.reduce((n, s) => n + (s.samples || []).length, 0);
    const photos = list.reduce((n, s) => n + (s.photoIds || []).length, 0);

    root.innerHTML = `<div class="screen list-screen">
      <header class="proj">
        <div class="proj-top">
          <h1>${esc(project.name)}</h1>
          <a class="btn sm" href="#/projects">${icon('folder')}${t('เปลี่ยนโปรเจกต์', 'Change project')}</a>
        </div>
        <p class="proj-stats">
          <span><b>${list.length}</b> Stations</span>
          <span><b>${samples}</b> Samples</span>
          <span><b>${photos}</b> Photos</span>
        </p>
        ${list.length ? `<div class="proj-btns">
          <a class="btn" href="#/summary">${icon('map')}${t('แผนที่สรุป', 'Summary map')}</a>
          <a class="btn" href="#/section">${icon('section')}${t('ภาพตัดขวาง', 'Cross section')}</a>
        </div>` : ''}
      </header>
      ${list.length
        ? `<ul class="st-list" id="stList">${list.map((st) => row(st, ends)).join('')}</ul>
           <p class="hint swipe-hint">${t('ปัดรายการไปทางซ้ายเพื่อแก้ไขหรือลบ', 'Swipe a station left to edit or delete it')}</p>`
        : `<div class="empty">
            <p>${t('ยังไม่มี Station ในโปรเจกต์นี้', 'No stations in this project yet')}<br>${t('ไปที่หน้า GPS แล้วกด NEW STATION เมื่อเจอ outcrop แรก', 'Go to GPS and tap NEW STATION at your first outcrop')}</p>
            <a class="btn" href="#/gps">${icon('gps')}${t('ไปหน้า GPS', 'Go to GPS')}</a>
          </div>`}
    </div>
    ${list.length ? `<div class="cta"><button type="button" class="btn-primary xl" id="btnExport">${icon('share')}<span>EXPORT</span></button></div>` : ''}`;

    dropThumbs();
    loadThumbs(list);
    root.querySelector('#btnExport')?.addEventListener('click', () => openExportSheet());
    detachSwipe?.();
    const ul = root.querySelector('#stList');
    detachSwipe = ul ? enableSwipe(ul, {
      onAction: async (act, li) => {
        const id = li.dataset.id;
        if (act === 'edit') { location.hash = `#/station/${id}/edit`; return; }
        const st = await store.getStation(id);
        if (!st) return paint();
        const n = (st.photoIds || []).length;
        if (!confirm(t(`ลบ ${st.code}${n ? ` และรูป ${n} รูป` : ''}? ย้อนกลับไม่ได้`, `Delete ${st.code}${n ? ` and its ${n} photo${n > 1 ? 's' : ''}` : ''}? This cannot be undone.`))) return;
        await store.deleteStation(st);
        toast(t(`ลบ ${st.code} แล้ว`, `${st.code} deleted`));
        paint();
      },
    }) : null;
  }
  await paint();
  return () => { detachSwipe?.(); dropThumbs(); };
}
