// Project summary image — preview, a few options, then save or share (Instagram, LINE, Photos).

import * as store from '../store.js';
import { renderSummary, duration } from '../summary.js';
import { icon } from '../icons.js';
import { setHeader, toast } from '../ui.js';
import { esc, debounce, stamp } from '../util.js';
import { deliver } from '../export.js';
import { t } from '../i18n.js';

const seg = (key, value, options) =>
  `<div class="seg" role="radiogroup" data-k="${key}">${options
    .map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;

export async function render(root, ctx) {
  const back = ctx.prev && !ctx.prev.startsWith('#/summary') ? ctx.prev : '#/stations';
  setHeader({
    left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="${t('กลับ', 'Back')}">${icon('back')}</button>`,
    title: `<span class="hdr-title">${t('แผนที่สรุป', 'Summary map')}</span>`,
  });
  document.getElementById('hdrBack').onclick = () => { location.hash = back; };

  const project = store.getProject();
  const stations = await store.listStations();
  if (!ctx.alive()) return;
  const located = stations.filter((s) => s.location);
  if (!located.length) {
    root.innerHTML = `<div class="empty"><p>${t('โปรเจกต์นี้ยังไม่มี Station ที่มีพิกัด', 'No station in this project has coordinates yet')}<br>${t('บันทึก Station อย่างน้อยหนึ่งจุดก่อน', 'Record at least one station first')}</p><a class="btn" href="#/gps">${icon('gps')}${t('ไปหน้า GPS', 'Go to GPS')}</a></div>`;
    return;
  }

  const settings = store.getSettings();
  const saved = settings.summary || {};
  // v1.2 saved a yes/no "basemap"; with no choice yet, follow the app's map (satellite or street)
  const background = ['plain', 'osm', 'sat', 'offline'].includes(saved.background) ? saved.background
    : saved.basemap === false ? 'plain' : saved.basemap === true ? 'osm'
      : settings.basemap === 'sat' ? 'sat' : 'osm';
  const opts = { format: saved.format || 'post', theme: saved.theme || 'dark', rotate: saved.rotate !== false, background };
  const NOTE = t('เวลาของแต่ละจุดคือเวลาที่กด NEW STATION ไม่นับการแก้ไขภายหลัง', 'Each point\'s time is when NEW STATION was tapped, not later edits.');
  const first = Math.min(...located.map((s) => s.createdAt));
  const last = Math.max(...located.map((s) => s.createdAt));

  root.innerHTML = `<div class="screen summary-screen">
    <div class="sum-preview" id="sumBox"><p class="loading"><i class="spinner"></i></p></div>
    <p class="sum-facts">${esc(project.name)}: ${located.length} Stations, ${t('เก็บข้อมูล', 'in the field for')} ${located.length > 1 ? duration(last - first) : '—'}</p>
    <div class="field"><span class="lbl">${t('ขนาดรูป', 'Picture size')}</span>${seg('format', opts.format, [['post', t('โพสต์ 4:5', 'Post 4:5')], ['story', t('สตอรี่ 9:16', 'Story 9:16')]])}</div>
    <div class="field"><span class="lbl">${t('พื้นหลัง', 'Background')}</span>${seg('background', opts.background, [['plain', t('เรียบ', 'Plain')], ['osm', t('แผนที่ OSM', 'Street')], ['sat', t('ดาวเทียม', 'Satellite')], ['offline', t('ออฟไลน์', 'Offline')]])}</div>
    <div class="field"><span class="lbl">${t('สี', 'Colours')}</span>${seg('theme', opts.theme, [['dark', t('มืด', 'Dark')], ['light', t('สว่าง', 'Light')]])}</div>
    <div class="field"><span class="lbl">${t('หมุนแผนที่ให้พอดีกรอบ', 'Rotate the map to fit')}</span>${seg('rotate', opts.rotate, [['true', t('หมุนได้', 'Allow')], ['false', t('ทิศเหนือขึ้นเสมอ', 'North always up')]])}</div>
    <p class="hint" id="sumNote">${NOTE}</p>
  </div>
  <div class="cta"><button type="button" class="btn-primary xl" id="btnShare" disabled>${icon('share')}<span>${t('บันทึกหรือแชร์รูป', 'Save or share the picture')}</span></button></div>`;

  const box = root.querySelector('#sumBox');
  const btn = root.querySelector('#btnShare');
  let file = null;
  let url = null;
  let job = 0;

  async function draw() {
    const my = ++job;
    btn.disabled = true;
    box.classList.add('busy');
    try {
      const out = await renderSummary({ project, stations, ...opts, zoneLock: store.zoneLock() });
      if (my !== job || !ctx.alive()) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(out.blob);
      const name = `GeoNote_${project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_${stamp()}.jpg`;
      file = new File([out.blob], name, { type: 'image/jpeg' });
      box.innerHTML = `<img src="${url}" alt="${t('แผนที่สรุปโปรเจกต์', 'Summary map of')} ${esc(project.name)}" width="${out.width}" height="${out.height}">`;
      box.dataset.rotation = String(out.rotation);
      box.dataset.background = out.background;
      // say what the picture really shows when it is not what was chosen; reset otherwise
      const note = root.querySelector('#sumNote');
      let why = '';
      if (opts.background !== 'plain' && out.background === 'plain') {
        why = opts.background === 'offline'
          ? t('ยังไม่มีแผนที่ออฟไลน์ของบริเวณนี้ในเครื่อง ดาวน์โหลดได้ที่ Settings → ข้อมูลออฟไลน์ตามภาค รูปนี้ใช้พื้นหลังแบบเรียบ', 'No offline map of this area on the phone yet (Settings → Offline data by region), so this picture has a plain background.')
          : t('โหลดแผนที่พื้นหลังไม่ได้ (ไม่มีอินเทอร์เน็ต และไม่มีแผนที่ออฟไลน์ของบริเวณนี้) รูปนี้ใช้พื้นหลังแบบเรียบ', 'Could not load the background (no internet and no offline map of this area), so this picture has a plain background.');
      } else if (out.background === 'offline' && opts.background !== 'offline') {
        why = t('ไม่มีอินเทอร์เน็ต รูปนี้ใช้แผนที่ออฟไลน์ในเครื่องแทน', 'No internet, so this picture uses the offline map on the phone.');
      }
      note.textContent = why ? `${why} ${NOTE}` : NOTE;
      btn.disabled = false;
    } catch (err) {
      if (my === job) box.innerHTML = `<p class="x-error">${t('สร้างรูปไม่สำเร็จ', 'Could not make the picture')}: ${esc(err.message)}</p>`;
    } finally {
      if (my === job) box.classList.remove('busy');
    }
  }
  const redraw = debounce(draw, 150);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.closest('.seg');
    group.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    const k = group.dataset.k;
    opts[k] = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
    store.updateSettings({ summary: { ...opts } });
    redraw();
  });

  btn.onclick = async () => {
    if (!file) return;
    const res = await deliver(file);
    if (res === 'downloaded') toast(t('บันทึกรูปแล้ว', 'Picture saved'));
    else if (res === 'shared') toast(t('แชร์รูปแล้ว', 'Picture shared'));
  };

  draw();
  return () => { job += 1; if (url) URL.revokeObjectURL(url); };
}
