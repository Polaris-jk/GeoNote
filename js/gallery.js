// Full-screen photo viewer, made to feel like the iPhone Photos app. Every photo is shown as its
// Smart Photo (the picture with the information strip on top), edge to edge.
//   • swipe left/right: the photos follow the finger and glide into place
//   • swipe down: the photo shrinks away and the viewer closes (also Esc or the phone's Back)
//   • tap: hide or show the bar
// The bar holds a small share button (save to the phone / send) and, in the station editor
// (`onDelete` given), a delete button.

import * as store from './store.js';
import { openOverlay, toast } from './ui.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { az3, cardinal } from './geomath.js';
import { smartFor } from './smartauto.js';
import { deliver } from './export.js';
import { t } from './i18n.js';

const SRC = {
  get exif() { return t('จากกล้อง', 'from the camera'); },
  get auto() { return t('อ่านตอนกดถ่ายรูป', 'read when the photo was taken'); },
  get aimed() { return t('เล็งตั้งเอง', 'aimed by hand'); },
  get camera() { return t('กล้องในแอป', 'in-app camera'); },
};
const GAP = 24; // px between photos while swiping, as in Photos
const EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
const SLIDE_MS = 300;

export async function openGallery(st, startId, { onDelete } = {}) {
  let metas = await store.listPhotos(st);
  if (!metas.length) return;
  const editable = !!onDelete;
  let i = Math.max(0, metas.findIndex((p) => p.id === startId));
  let cache = new Map(); // photo id → { file, url } | Promise
  let animating = false;
  let popped = false;

  const { el, close } = openOverlay(`<div class="lightbox" role="dialog" aria-label="${t('รูปของ', 'Photos of')} ${esc(st.code)}">
      <div class="lb-stage">
        <div class="lb-track">
          <div class="lb-slide"><img alt="" draggable="false"><span class="lb-wait">${t('กำลังเตรียม Smart Photo', 'Preparing Smart Photo')}</span></div>
          <div class="lb-slide"><img alt="" draggable="false"><span class="lb-wait">${t('กำลังเตรียม Smart Photo', 'Preparing Smart Photo')}</span></div>
          <div class="lb-slide"><img alt="" draggable="false"><span class="lb-wait">${t('กำลังเตรียม Smart Photo', 'Preparing Smart Photo')}</span></div>
        </div>
      </div>
      <div class="lb-bar">
        <button type="button" class="lb-ic" data-lb="share" aria-label="${t('บันทึกหรือแชร์ Smart Photo', 'Save or share Smart Photo')}" disabled>${icon('share')}</button>
        <div class="lb-info">
          <span class="lb-title"></span>
          <span class="lb-brg"></span>
        </div>
        ${editable ? `<button type="button" class="lb-ic danger" data-lb="del" aria-label="${t('ลบรูป', 'Delete photo')}">${icon('trash')}</button>` : '<span class="lb-ic-space"></span>'}
      </div>
    </div>`, {
    cls: 'full',
    onClose: () => {
      for (const v of cache.values()) if (v && v.url) URL.revokeObjectURL(v.url);
      cache = new Map();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      // closed by a swipe or Esc: drop the history entry added when the viewer opened
      if (!popped && history.state && history.state.lodestarViewer) history.back();
    },
    onClick: async (e, closeIt) => {
      const b = e.target.closest('[data-lb]');
      if (!b || b.disabled) return;
      const act = b.dataset.lb;
      if (act === 'del' && onDelete) {
        if (!confirm(t('ลบรูปนี้? ย้อนกลับไม่ได้', 'Delete this photo? This cannot be undone.'))) return;
        await onDelete(metas[i].id);
        toast(t('ลบรูปแล้ว', 'Photo deleted'));
        metas = await store.listPhotos(st);
        if (!metas.length) return closeIt();
        i = Math.min(i, metas.length - 1);
        layout();
      } else if (act === 'share') {
        const got = cache.get(metas[i].id);
        if (!got || !got.file) return;
        const res = await deliver(got.file);
        if (res === 'downloaded') toast(t('ดาวน์โหลดรูปแล้ว', 'Photo downloaded'));
        else if (res === 'shared') toast(t('ส่งรูปแล้ว', 'Photo shared'));
        if (res !== 'cancelled') {
          metas[i] = await store.updatePhoto(metas[i].id, { smartSavedAt: Date.now() }, { touch: false });
          renderInfo();
        }
      }
    },
  });

  // the phone's Back button / gesture closes the viewer instead of leaving the page
  history.pushState({ lodestarViewer: true }, '');
  function onPop() { popped = true; close(); }
  window.addEventListener('popstate', onPop);

  const box = el.querySelector('.lightbox');
  const stage = el.querySelector('.lb-stage');
  const track = el.querySelector('.lb-track');
  const title = el.querySelector('.lb-title');
  const brg = el.querySelector('.lb-brg');
  const share = el.querySelector('[data-lb=share]');

  /** The Smart Photo for photo n (kept copy, or drawn now). */
  function smartAt(n) {
    const meta = metas[n];
    if (!meta) return Promise.resolve(null);
    const have = cache.get(meta.id);
    if (have) return have instanceof Promise ? have : Promise.resolve(have);
    const job = (async () => {
      const cur = await store.getStation(st.id) || st;
      const { file, meta: next } = await smartFor(cur, meta, n, metas.length);
      const idx = metas.findIndex((m) => m.id === meta.id);
      if (idx >= 0) metas[idx] = next;
      const got = { file, url: URL.createObjectURL(file) };
      cache.set(meta.id, got);
      return got;
    })().catch((err) => {
      cache.delete(meta.id);
      toast(t(`สร้าง Smart Photo ไม่สำเร็จ: ${err.message}`, `Could not make the Smart Photo: ${err.message}`), 4000);
      return null;
    });
    cache.set(meta.id, job);
    return job;
  }

  function fill(slide, n) {
    const img = slide.querySelector('img');
    slide.dataset.n = String(n);
    img.style.transform = '';
    img.style.transition = '';
    img.style.opacity = '';
    if (n < 0 || n >= metas.length) { img.removeAttribute('src'); slide.className = 'lb-slide empty'; return; }
    img.alt = t(`${st.code} Smart Photo รูปที่ ${n + 1}`, `${st.code} Smart Photo ${n + 1}`);
    const have = cache.get(metas[n].id);
    if (have && have.url) {
      if (img.getAttribute('src') !== have.url) img.src = have.url;
      slide.className = 'lb-slide ready';
      return;
    }
    img.removeAttribute('src');
    slide.className = 'lb-slide';
    smartAt(n).then((got) => {
      if (!got || slide.dataset.n !== String(n)) return;
      img.src = got.url;
      slide.className = 'lb-slide ready';
      if (n === i) { share.disabled = false; renderInfo(); }
    });
  }

  function renderInfo() {
    const m = metas[i];
    title.textContent = `${st.code} · ${i + 1}/${metas.length}`;
    const dir = m.bearing != null
      ? `${m.bearingSrc === 'auto' ? '≈' : ''}${az3(Math.round(m.bearing) % 360)}° ${cardinal(m.bearing)} · ${SRC[m.bearingSrc] || ''}`
      : '';
    const kept = m.smartSavedAt ? t('บันทึกลงเครื่องแล้ว', 'saved to the phone') : '';
    brg.textContent = [dir, kept].filter(Boolean).join(' · ');
  }

  const offset = (k) => `calc(${k * 100}% + ${k * GAP}px)`;
  const slides = [...el.querySelectorAll('.lb-slide')]; // previous, current, next (rotated as you swipe)

  function place() {
    slides.forEach((s, k) => { s.style.transform = `translate3d(${offset(k - 1)},0,0)`; });
  }
  function afterMove() {
    const cur = cache.get(metas[i].id);
    share.disabled = !(cur && cur.file);
    renderInfo();
    // get the neighbours ready so the next swipe is instant
    smartAt(i).then(() => { smartAt(i + 1); smartAt(i - 1); });
  }

  /** Put photos i−1, i, i+1 on the three slides, centred, without animation. */
  function layout() {
    track.style.transition = 'none';
    track.style.transform = 'translate3d(0,0,0)';
    place();
    fill(slides[0], i - 1);
    fill(slides[1], i);
    fill(slides[2], i + 1);
    afterMove();
  }

  /** Glide to the next (+1) or previous (−1) photo. */
  function go(dir, fast = false) {
    const n = i + dir;
    if (animating) return;
    if (n < 0 || n >= metas.length) { settle(); return; }
    animating = true;
    const ms = fast ? 220 : SLIDE_MS;
    track.style.transition = `transform ${ms}ms ${EASE}`;
    track.style.transform = `translate3d(${offset(-dir)},0,0)`;
    setTimeout(() => {
      i = n;
      // move the slide that went off-screen to the other side; the photos on screen stay as they are
      if (dir > 0) slides.push(slides.shift()); else slides.unshift(slides.pop());
      track.style.transition = 'none';
      track.style.transform = 'translate3d(0,0,0)';
      place();
      if (dir > 0) fill(slides[2], i + 1); else fill(slides[0], i - 1);
      animating = false;
      afterMove();
    }, ms);
  }
  function settle() {
    track.style.transition = `transform ${SLIDE_MS}ms ${EASE}`;
    track.style.transform = 'translate3d(0,0,0)';
  }

  // ---------- gestures ----------
  const curImg = () => slides[1].querySelector('img');
  let g = null; // { x, y, t, id, mode: null | 'x' | 'y', dx, dy, samples }

  function velocity(gest, axis) {
    // px/ms over the last ~80 ms of movement
    const s = gest.samples;
    const last = s[s.length - 1];
    let k = s.length - 1;
    while (k > 0 && last.t - s[k - 1].t < 80) k--;
    const first = s[Math.max(0, k - 1)];
    const dt = Math.max(1, last.t - first.t);
    return (axis === 'x' ? last.x - first.x : last.y - first.y) / dt;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (animating || (e.pointerType === 'mouse' && e.button !== 0) || g) return;
    g = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, mode: null, dx: 0, dy: 0, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (g.samples.length > 12) g.samples.shift();
    if (!g.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      g.mode = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (g.mode === 'x') track.style.transition = 'none';
      else { curImg().style.transition = 'none'; box.style.transition = 'none'; box.classList.add('dragging'); }
    }
    if (g.mode === 'x') {
      const atEdge = (dx > 0 && i === 0) || (dx < 0 && i === metas.length - 1);
      g.dx = atEdge ? dx * 0.3 : dx;
      track.style.transform = `translate3d(${g.dx}px,0,0)`;
    } else {
      // pull down to close: the photo follows the finger and shrinks, the black fades
      g.dx = dx;
      g.dy = dy > 0 ? dy : dy * 0.25;
      const p = Math.min(1, Math.max(0, g.dy) / (stage.clientHeight * 0.6 || 400));
      curImg().style.transform = `translate3d(${g.dx * 0.8}px,${g.dy}px,0) scale(${1 - p * 0.35})`;
      box.style.setProperty('--lb-bg', String(1 - p * 0.85));
    }
  });

  function endGesture(e) {
    if (!g || e.pointerId !== g.id) return;
    const d = g;
    g = null;
    const dt = performance.now() - d.t;
    if (!d.mode) {
      // a tap shows or hides the bar
      if (dt < 400 && e.type === 'pointerup') box.classList.toggle('ui-off');
      return;
    }
    if (d.mode === 'x') {
      const w = stage.clientWidth || 1;
      const v = velocity(d, 'x');
      if (d.dx < -w * 0.25 || (v < -0.35 && d.dx < -20)) go(1, v < -0.8);
      else if (d.dx > w * 0.25 || (v > 0.35 && d.dx > 20)) go(-1, v > 0.8);
      else settle();
      return;
    }
    const v = velocity(d, 'y');
    const img = curImg();
    box.classList.remove('dragging');
    if (d.dy > 110 || (v > 0.45 && d.dy > 30)) {
      // fly out downwards, then close
      animating = true;
      img.style.transition = `transform 220ms ease-in, opacity 220ms ease-in`;
      img.style.transform = `translate3d(${d.dx * 0.8}px,${d.dy + stage.clientHeight * 0.5}px,0) scale(0.6)`;
      img.style.opacity = '0';
      box.style.transition = 'background-color 220ms linear';
      box.style.setProperty('--lb-bg', '0');
      setTimeout(() => close(), 210);
    } else {
      img.style.transition = `transform 260ms ${EASE}`;
      img.style.transform = '';
      box.style.transition = 'background-color 260ms linear';
      box.style.setProperty('--lb-bg', '1');
    }
  }
  stage.addEventListener('pointerup', endGesture);
  stage.addEventListener('pointercancel', endGesture);

  function onKey(e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }
  document.addEventListener('keydown', onKey);

  layout();
  if (!store.getSettings().viewerHint) {
    toast(t('ปัดซ้าย-ขวาเพื่อดูรูปอื่น · ปัดลงเพื่อปิด', 'Swipe left or right for more photos · swipe down to close'), 3200);
    store.updateSettings({ viewerHint: true });
  }
  return close;
}
