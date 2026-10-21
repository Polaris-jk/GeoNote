// Cross section along the stations in order — preview, scales, and a per-station editor.
// Changes made here (rock, colour, dip, leaving a station out, where a contact sits, the part a
// rock plays: bed, cover on an unconformity, intrusion) are kept with the cross section only; the
// notebook is never changed from this screen. The picture is an example worked out by the app,
// and the screen says so under it.

import * as store from '../store.js';
import * as dem from '../dem.js';
import * as xs from '../xsection.js';
import { ensureColors, ROCK_COLORS, pickColor } from '../rockcolors.js';
import { LITHOLOGY } from '../vocab.js';
import { icon } from '../icons.js';
import { setHeader, toast, openOverlay } from '../ui.js';
import { esc, debounce, stamp, parseNum, trim1 } from '../util.js';
import { az3, strikeToDipDir, dipDirToStrike, norm360, cardinal } from '../geomath.js';
import { deliver } from '../export.js';
import { t } from '../i18n.js';
import { walkEnds, shapeOf, shapeSVG } from '../pointtype.js';

const seg = (key, value, options) =>
  `<div class="seg" role="radiogroup" data-k="${key}">${options
    .map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;

// Colours of the DMR 1:250,000 geological map legend (data/rock_colors.json), one or two per age
// and the main igneous rocks, offered with the unit symbol so a rock can take its formation's colour.
const DMR_SWATCHES = [
  ['Qa', '#FFFFB4'], ['Qt', '#FFFF64'], ['Tmm', '#FFEB45'], ['KTms', '#00BE2D'], ['KTpk', '#C2EB5A'],
  ['Kkk', '#91D700'], ['Kpp', '#5A8787'], ['Ksk', '#00BEFF'], ['JKpw', '#ABFFFF'], ['Jpk', '#0078FF'],
  ['Trnp', '#AC9AC8'], ['Trhl', '#98A5FF'], ['Pr', '#FD6D00'], ['Ps', '#DC7846'], ['CPk', '#AA6E37'],
  ['C', '#7D8585'], ['D', '#B99B64'], ['SD', '#8C7850'], ['O', '#00B464'], ['E', '#7F7014'],
  ['Tbs', '#E65E8A'], ['Tv', '#F57F96'], ['PTrv', '#FF73B4'], ['Trgr', '#FFC8FF'], ['Cgr', '#FF96FF'],
];
/** Dark or white text, whichever reads better on this colour. */
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? '#1d2329' : '#ffffff';
}

const plane = (p) => (p ? `${az3(p.strike)}/${trim1(p.dip)}` : '');
const appText = (app) => (app == null ? '' : Math.abs(app) < 0.5
  ? t('ปรากฏในแนวตัด ~0° (แนวราบ)', 'apparent ~0° (flat)')
  : t(`ปรากฏในแนวตัด ${trim1(Math.abs(app))}° เอียงไปทาง ${app > 0 ? 'A′' : 'A'}`, `apparent ${trim1(Math.abs(app))}° toward ${app > 0 ? 'A′' : 'A'}`));
const rockName = (r) => (r ? `${esc(r.name)}${r.th ? ` <i>${esc(r.th)}</i>` : ''}` : '');

export async function render(root, ctx) {
  const back = ctx.prev && !ctx.prev.startsWith('#/section') ? ctx.prev : '#/stations';
  setHeader({
    left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="${t('กลับ', 'Back')}">${icon('back')}</button>`,
    title: `<span class="hdr-title">${t('ภาพตัดขวาง', 'Cross section')}</span>`,
  });
  document.getElementById('hdrBack').onclick = () => { location.hash = back; };

  const project = store.getProject();
  const stations = (await store.listStations()).sort((a, b) => (a.number || 0) - (b.number || 0));
  const cfg = await xs.loadConfig(project.id);
  await ensureColors(stations);
  if (!ctx.alive()) return;
  const located = stations.filter((s) => s.location);
  if (located.length < 2) {
    root.innerHTML = `<div class="empty"><p>${t('ภาพตัดขวางต้องมี Station ที่มีพิกัดอย่างน้อย 2 จุด', 'A cross section needs at least 2 stations with coordinates')}<br>${t('แนวตัดลากผ่าน Station ตามลำดับที่บันทึก', 'The section runs through the stations in the order they were made')}</p><a class="btn" href="#/gps">${icon('gps')}${t('ไปหน้า GPS', 'Go to GPS')}</a></div>`;
    return;
  }

  const firstCode = located[0].code, lastCode = located[located.length - 1].code;
  root.innerHTML = `<div class="screen xsec-screen">
    <div class="xs-box" id="xsBox"><div class="xs-scroll" id="xsScroll"><canvas id="xsCanvas" aria-label="${t('ภาพตัดขวาง แตะสัญลักษณ์ของจุดเพื่อแก้', 'Cross section. Tap a point symbol to edit it')}"></canvas></div></div>
    <p class="xs-disclaimer">${icon('info')}<span>${xs.DISCLAIMER()}</span></p>
    <p class="xs-status" id="xsStatus"></p>
    <div class="xs-notes" id="xsNotes"></div>
    <div class="field"><span class="lbl">${t('แนวตัด', 'Section line')}</span>${seg('line', cfg.line === 'strike' ? 'strike' : 'path', [['path', t('ตามทางเดิน', 'Along the walk')], ['strike', t('ตรง ตั้งฉากแนวระดับ', 'Straight, across strike')]])}
      <p class="hint" id="lineHint"></p></div>
    <div class="field"><span class="lbl">${t('อัตราส่วนแกนตั้ง (V.E.)', 'Vertical exaggeration (V.E.)')}</span>
      <div class="xs-ve"><button type="button" class="chip" id="veAuto" aria-pressed="false">${t('อัตโนมัติ', 'Auto')}</button>
      <input type="range" id="veRange" min="0" max="${xs.NICE_VE.length - 1}" step="1" aria-label="${t('อัตราส่วนแกนตั้ง', 'Vertical exaggeration')}"><b class="mono" id="veOut">×1</b></div>
    </div>
    <div class="field"><span class="lbl">${t('ความลึกที่วาด (ม. ใต้จุดต่ำสุดของพื้นดิน)', 'Depth drawn (m below the lowest ground)')}</span><div id="depthSeg"></div></div>
    <div class="field"><span class="lbl">${t('ใต้ดิน', 'Below ground')}</span>${seg('under', cfg.under !== false, [['true', t('แสดงชั้นหิน', 'Show the beds')], ['false', t('เฉพาะผิวดิน', 'Ground only')]])}</div>
    <div class="field"><span class="lbl">${t('ทิศของภาพ (ซ้าย → ขวา)', 'Direction (left → right)')}</span><div id="flipSeg"></div></div>
    <div class="field"><span class="lbl">${t('ขนาดภาพบนจอ', 'Size on screen')}</span>${seg('zoom', cfg.zoom || 1, [['1', t('พอดีจอ', 'Fit')], ['2', '×2'], ['3', '×3']])}</div>

    <section class="xs-sec">
      <h2 class="sec-h">${t('หิน', 'Rocks')}<span class="sec-note">${t('จากชั้นบนลงชั้นล่าง · แตะเพื่อเปลี่ยนชนิดหรือสี', 'top to bottom · tap to change its part or colour')}</span></h2>
      <ul class="xs-rocks" id="xsRocks"></ul>
    </section>
    <section class="xs-sec">
      <h2 class="sec-h">Stations<span class="sec-note">${t('แตะเพื่อแก้ในภาพนี้', 'tap to edit for this picture')}</span></h2>
      <ul class="xs-list" id="xsList"></ul>
      <p class="hint">${t('การแก้ในหน้านี้ใช้กับภาพตัดขวางเท่านั้น ข้อมูลในสมุดบันทึกไม่เปลี่ยน เช่น ปิดจุดที่เจอหินแปลกปลอม (ก้อนหินที่กลิ้งมา ไม่ใช่หินในที่) หรือแก้ชนิดหิน สี และมุมเอียง', 'Changes here apply to the cross section only; the notebook stays as it is. For example, leave out a station where the rock was a loose block (float), or change its rock, colour or dip.')}</p>
      <button type="button" class="btn-text danger" id="xsReset">${t('ล้างการแก้ไขทั้งหมดในภาพนี้', 'Clear every change in this picture')}</button>
    </section>
  </div>
  <div class="cta"><button type="button" class="btn-primary xl" id="xsShare" disabled>${icon('share')}<span>${t('บันทึกหรือแชร์รูป', 'Save or share the picture')}</span></button></div>`;

  const q = (s) => root.querySelector(s);
  const canvas = q('#xsCanvas');
  const box = q('#xsBox');
  let path = null, ground = null, demRes = null, sig = null, model = null, shown = null;
  let job = 0;

  const save = debounce(() => xs.saveConfig(project.id, cfg).catch(() => {}), 400);

  // ---------- ground heights ----------
  async function prepareGround(my, force = false) {
    if (!force && path.signature === sig && ground) return;
    const p0 = path;
    sig = null;
    const status = q('#xsStatus');
    status.innerHTML = `<i class="spinner"></i> ${t('กำลังหาความสูงพื้นดินตามแนว…', 'Getting ground heights along the line…')}`;
    const res = await dem.prepare(p0.samples, {
      onProgress: (n, total) => { if (ctx.alive() && my === job) status.innerHTML = `<i class="spinner"></i> ${t(`กำลังโหลดความสูงพื้นดิน ${n}/${total}`, `Downloading ground heights ${n}/${total}`)}`; },
    });
    if (my !== job) return; // a newer change took over; it fetches its own heights
    demRes = res;
    ground = xs.groundLine(p0, res.ok ? res.sample : null);
    sig = p0.signature;
  }

  function paintStatus() {
    const el = q('#xsStatus');
    if (ground.src === 'dem') {
      el.innerHTML = `${icon('check')} ${t('ความสูงพื้นดินจาก', 'Ground heights from')} ${esc(demRes.source.name)} · ${t('เก็บไว้ในเครื่องแล้ว เปิดดูตอนไม่มีเน็ตได้', 'kept on the phone, works with no internet')}`;
      el.className = 'xs-status ok';
      return;
    }
    const why = demRes?.reason === 'offline'
      ? t('ไม่มีเน็ต และยังไม่มีความสูง (DEM) ของบริเวณนี้ในเครื่อง', 'No internet, and no heights (DEM) of this area on the phone yet')
      : demRes?.reason === 'far' ? t('แนวตัดยาวเกินกว่าจะโหลด DEM ได้', 'The line is too long to load the DEM')
        : t('โหลดความสูง (DEM) ไม่ได้', 'Could not load the heights (DEM)');
    el.className = 'xs-status warn';
    el.innerHTML = `${why} · ${ground.src === 'gps' ? t('ใช้ความสูงจาก GPS ของแต่ละ Station แทน (หยาบ ±10–20 ม.)', 'using the GPS heights of the stations instead (rough, ±10–20 m)') : t('วาดพื้นดินเป็นแนวราบ', 'the ground is drawn flat')}
      <button type="button" class="link-btn" id="xsRetry">${t('ลองอีกครั้ง', 'Try again')}</button>
      <span class="xs-tip">${t('ดาวน์โหลด DEM ล่วงหน้าได้ที่ปุ่มแผนที่ในหน้า Map', 'Download the DEM ahead with the map button on the Map screen')}</span>`;
  }

  // ---------- model and preview ----------
  async function refresh({ forceGround = false } = {}) {
    const my = ++job;
    path = xs.makePath(stations, cfg);
    if (!path.ok) {
      box.classList.add('hidden');
      q('#xsStatus').className = 'xs-status warn';
      q('#xsStatus').textContent = path.reason === 'short'
        ? t('Station ในแนวอยู่ใกล้กันเกินไป (ห่างกันรวมไม่ถึง 5 ม.)', 'The stations on the line are too close together (under 5 m in all)')
        : path.reason === 'across'
          ? t('Station เรียงตัวตามแนวระดับของชั้นหิน เส้นตรงที่ตั้งฉากแนวระดับจึงสั้นเกินไป ใช้แนวตัดแบบตามทางเดินแทน', 'The stations lie along the strike, so a straight line across it is too short. Use the line along the walk instead.')
          : t('ต้องมี Station ในแนวตัดอย่างน้อย 2 จุด ถ้าปิดบาง Station ออกจากแนวไว้ ให้แตะในรายการด้านล่างแล้วเปิดกลับ', 'At least 2 stations must be on the line. If you took some off the line, tap them in the list below and switch them back on.');
      model = null;
      shown = null;
      q('#xsShare').disabled = true;
      q('#xsNotes').innerHTML = '';
      paintLine();
      paintLists();
      return;
    }
    box.classList.remove('hidden');
    box.classList.add('busy');
    await prepareGround(my, forceGround);
    if (my !== job || !ctx.alive()) return;
    model = xs.buildModel(path, ground, cfg);
    // forget colours picked for rock names that are gone (e.g. half-typed while editing)
    const live = new Set(model.rocks.map((r) => r.key));
    for (const st of stations) { const k = xs.rockGroup(st.lithology); if (k) live.add(k); }
    for (const o of Object.values(cfg.over)) if (o.rock) live.add(xs.rockGroup(o.rock));
    let pruned = false;
    for (const k of Object.keys(cfg.autoColors)) if (!live.has(k)) { delete cfg.autoColors[k]; pruned = true; }
    if (model.cfgChanged || pruned) save();
    paintLine();
    paintStatus();
    await draw(my);
    paintNotes();
    paintLists();
  }

  async function draw(my = job) {
    if (!model) return;
    const zoom = Number(cfg.zoom) || 1;
    const width = Math.max(280, box.clientWidth - 2) * zoom;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const scroller = q('#xsScroll');
    const keep = scroller.scrollWidth > scroller.clientWidth ? scroller.scrollLeft / (scroller.scrollWidth - scroller.clientWidth) : 0;
    const res = await xs.renderSection(canvas, model, { mode: 'preview', width, ratio, ve: cfg.ve, depth: cfg.depth, under: cfg.under !== false });
    if (my !== job || !ctx.alive()) return;
    canvas.style.width = `${res.width}px`;
    canvas.style.height = `${res.height}px`;
    scroller.scrollLeft = keep * Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    shown = res;
    box.classList.remove('busy');
    q('#xsShare').disabled = false;
    // scale controls show what is drawn
    const autoVE = xs.autoVE(model);
    const veAuto = q('#veAuto');
    veAuto.setAttribute('aria-pressed', String(cfg.ve === 'auto'));
    veAuto.textContent = t(`อัตโนมัติ ×${autoVE}`, `Auto ×${autoVE}`);
    q('#veOut').textContent = `×${+res.ve.toFixed(1)}`;
    const idx = xs.NICE_VE.reduce((bi, v, i) => (Math.abs(v - res.ve) < Math.abs(xs.NICE_VE[bi] - res.ve) ? i : bi), 0);
    q('#veRange').value = String(idx);
    const autoD = xs.autoDepth(model, res.ve);
    q('#depthSeg').innerHTML = seg('depth', cfg.depth, [['auto', t(`อัตโนมัติ ${autoD}`, `Auto ${autoD}`)], ...xs.DEPTH_CHOICES.map((d) => [d, `${d}`])]);
  }

  const redraw = debounce(() => refresh(), 160);

  /** The direction choice (station codes, or compass points for the straight line) and the line note. */
  function paintLine() {
    const straight = cfg.line === 'strike';
    let a = `${esc(firstCode)} → ${esc(lastCode)}`, b = `${esc(lastCode)} → ${esc(firstCode)}`;
    if (straight && model) {
      const az0 = norm360(model.overall + (cfg.flip ? 180 : 0)); // the bearing before any flip
      a = `${cardinal(az0 + 180)} → ${cardinal(az0)}`;
      b = `${cardinal(az0)} → ${cardinal(az0 + 180)}`;
    }
    q('#flipSeg').innerHTML = seg('flip', !!cfg.flip, [['false', a], ['true', b]]);
    const hint = q('#lineHint');
    if (!straight) hint.textContent = t('ลากผ่าน Station ตามลำดับที่บันทึก (ST-001 → ST-002 → …) ถ้าแนวเดินคดเคี้ยวมาก ใช้แบบเส้นตรงจะได้ภาพที่ถูกต้องกว่า', 'Through the stations in the order they were made (ST-001 → ST-002 → …). If the walk winds a lot, the straight line gives a truer picture.');
    else if (!model) hint.textContent = '';
    else if (model.how === 'strike') hint.textContent = t(`เส้นตรงทิศ ${az3(model.overall)}° ผ่านกลางกลุ่ม Station ตั้งฉากกับแนวระดับเฉลี่ยของชั้นหิน แต่ละ Station ถูกฉายลงแนวตามแนวระดับ`, `A straight line bearing ${az3(model.overall)}° through the middle of the stations, across the mean strike of the beds; each station is projected onto it along strike.`);
    else hint.textContent = t(`ยังไม่มีมุมเอียงให้หาแนวระดับ จึงลากเส้นตรงทิศ ${az3(model.overall)}° ตามการกระจายของ Station`, `No dips to find the strike from yet, so the straight line (bearing ${az3(model.overall)}°) follows the spread of the stations.`);
  }

  function paintNotes() {
    if (!model) return;
    const notes = [];
    if (model.line === 'strike') {
      const far = model.pts.filter((p) => Math.abs(p.off) > Math.max(200, 0.25 * model.L));
      if (far.length) notes.push(t(`${far.map((p) => `${p.st.code} (${xs.distText(Math.abs(p.off))})`).join(', ')} อยู่ห่างจากแนวตัดมาก ข้อมูลที่ฉายมาอาจไม่ตรงกับแนวนี้ ถ้าไม่ต้องการ ปิด "ฉายจุดนี้ลงแนวตัด"`, `${far.map((p) => `${p.st.code} (${xs.distText(Math.abs(p.off))})`).join(', ')} lie far from the line, so what is projected may not hold there. If needed, switch off "Project onto the line".`));
    }
    if (shown?.clipped) notes.push(t('ภาพสูงเกินไป จึงลดความลึกหรืออัตราส่วนแกนตั้งลงให้', 'The picture was too tall, so the depth or vertical scale was reduced'));
    if (model.bends.length) notes.push(t(`แนวเดินหักมุมที่ ${model.bends.map((b) => `${b.code} (${Math.round(b.angle)}°)`).join(', ')} ภาพช่วงนั้นบิด (เส้นจุดแนวตั้ง) ถ้าจุดไหนออกนอกแนวมาก ปิด "ให้แนวตัดผ่านจุดนี้"`, `The path turns at ${model.bends.map((b) => `${b.code} (${Math.round(b.angle)}°)`).join(', ')}; the picture bends there (dotted lines). If a station is far off the line, switch off "Section runs through here".`));
    const guessed = model.rocks.filter((r) => r.autoRole && r.role !== 'layer');
    if (guessed.length) notes.push(t(`แอปตั้งให้อัตโนมัติจากชื่อหิน: ${guessed.map((r) => `${esc(r.name)} เป็น${xs.roleName(r.role)}`).join(', ')} · แตะชื่อหินในรายการด้านล่างเพื่อเปลี่ยน`, `Set from the rock names: ${guessed.map((r) => `${esc(r.name)} is ${xs.roleName(r.role)}`).join(', ')} · tap the rock in the list below to change it`));
    if (model.rocks.some((r) => r.coverAsBeds)) notes.push(t('ทุกจุดในแนวนี้เป็นชั้นปิดทับ ไม่มีหินที่แก่กว่าให้ปิดทับ จึงวาดเป็นชั้นหินปกติ', 'Every station on this line is cover, with no older rock under it to show, so it is drawn as ordinary beds'));
    if (!model.hasDips) notes.push(t('ยังไม่มีมุมเอียง (Bedding) ในแนวนี้ ชั้นหินจึงวาดเป็นแนวราบ', 'No bedding dips on this line yet, so the beds are drawn flat'));
    if (!model.rocks.length) notes.push(t('ยังไม่มีชนิดหินในแนวนี้ ใต้ดินจึงเป็นสีเทา', 'No rock types on this line yet, so the ground is grey'));
    if (path.noCoord) notes.push(t(`${path.noCoord} Station ไม่มีพิกัด จึงไม่อยู่ในแนวตัด`, `${path.noCoord} station(s) have no coordinates and are not on the line`));
    q('#xsNotes').innerHTML = notes.map((n) => `<p>${n}</p>`).join('');
  }

  function paintLists() {
    const rocksEl = q('#xsRocks');
    rocksEl.innerHTML = model?.order.length
      ? model.order.map((r) => `<li><button type="button" class="xs-rock" data-rock="${esc(r.key)}"><i class="xs-sw" style="background:${r.color}"></i><span>${rockName(r)}${r.role !== 'layer' ? `<em class="xs-role">${xs.roleShort(r.role)}</em>` : ''}</span><small>${r.n} Station${r.n > 1 ? 's' : ''}</small></button></li>`).join('')
      : `<li class="sec-empty">${t('ยังไม่มีชนิดหินในแนวนี้', 'No rock types on this line yet')}</li>`;
    const byId = new Map((model?.pts || []).map((p) => [p.st.id, p]));
    const ends = walkEnds(stations);
    q('#xsList').innerHTML = stations.map((st) => {
      const p = byId.get(st.id);
      const e = p || xs.effective(st, cfg);
      const r = p && p.rockIdx != null ? model.rocks[p.rockIdx] : null;
      const tags = [];
      if (!st.location) tags.push(t('ไม่มีพิกัด', 'no coordinates'));
      else if (e.offPath) tags.push(t('ไม่อยู่ในแนว', 'off the line'));
      else if (e.skip) tags.push(t('ไม่ใช้ข้อมูล', 'not used'));
      if (e.edited) tags.push(t('แก้ในภาพ', 'changed here'));
      const meta = [e.plane ? `${plane(e.plane)}${p?.app != null ? ` · ${appText(p.app)}` : ''}` : t('ไม่มีมุมเอียง', 'no dip')];
      if (p && model.line === 'strike' && Math.abs(p.off) >= 1) meta.push(` · ${t('ห่างแนว', 'off the line')} ${xs.distText(Math.abs(p.off))}`);
      return `<li><button type="button" class="xs-row${e.skip || e.offPath || !st.location ? ' off' : ''}" data-id="${st.id}"${st.location ? '' : ' disabled'}>
        <span class="xs-code">${esc(st.code)}</span>
        ${shapeSVG(p ? p.shape : shapeOf(st, ends), r ? r.color : '#ffffff', 'pt-shape xs-pt')}
        <span class="xs-body"><b>${e.rock ? esc(e.rock) : `<span class="muted">${t('ไม่ระบุหิน', 'no rock')}</span>`}</b><small>${meta.join('')}</small></span>
        ${tags.length ? `<em class="xs-tag">${tags.join(' · ')}</em>` : ''}
      </button></li>`;
    }).join('');
  }

  // ---------- colour controls (shared by the station editor and the rock list) ----------
  const colorHTML = (key) => {
    const r = model?.rocks.find((x) => x.key === key);
    if (!r) return '';
    const sw = Object.values(ROCK_COLORS).map(([c]) => `<button type="button" class="xs-swb" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    const dmr = DMR_SWATCHES.map(([sym, c]) => `<button type="button" class="xs-dmrb" data-color="${c}" style="background:${c};color:${inkOn(c)}" aria-label="${sym} ${c}">${sym}</button>`).join('');
    return `<div class="xs-colors" data-key="${esc(key)}">
      <label class="xs-pick"><input type="color" data-o="color" value="${r.color}"><i style="background:${r.color}"></i></label>
      <div class="xs-swatches">${sw}</div>
      <p class="xs-sw-h">${t('สีหน่วยหินตามแผนที่ธรณีวิทยา กรมทรัพยากรธรณี', 'Colours of the DMR geological map units')}</p>
      <div class="xs-dmr">${dmr}</div>
      <div class="xs-cbtns"><button type="button" class="btn sm" data-act="random">${t('สุ่มสี', 'Random')}</button><button type="button" class="btn sm" data-act="defcolor"${cfg.colors[key] ? '' : ' disabled'}>${t('สีเดิม', 'Default')}</button></div>
    </div>`;
  };
  function setColor(key, color) {
    if (color) cfg.colors[key] = color; else delete cfg.colors[key];
    save();
    redraw();
  }
  function onColorClick(e, key, after) {
    const sw = e.target.closest('[data-color]');
    if (sw) { setColor(key, sw.dataset.color); after(sw.dataset.color); return true; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'random') {
      const used = (model?.rocks || []).filter((r) => r.key !== key).map((r) => r.color);
      const c = pickColor(`${key}${Math.random()}`, used);
      setColor(key, c); after(c); return true;
    }
    if (act === 'defcolor') {
      setColor(key, null);
      after(model?.rocks.find((r) => r.key === key)?.defaultColor || '#9aa0a6');
      return true;
    }
    return false;
  }
  const syncColor = (el, c) => {
    const box2 = el.querySelector('.xs-colors');
    if (!box2) return;
    box2.querySelector('input[type=color]').value = c;
    box2.querySelector('.xs-pick i').style.background = c;
    const def = box2.querySelector('[data-act=defcolor]');
    if (def) def.disabled = !cfg.colors[box2.dataset.key];
  };

  // ---------- one rock: the part it plays in the picture, and its colour ----------
  const ROLE_WHAT = () => ({
    layer: t('ชั้นหิน: ส่วนหนึ่งของชั้นที่เอียงหรือคดโค้งตามมุมเอียงที่วัด', 'Bed: part of the tilted or folded beds, following the measured dips'),
    cover: t('ชั้นปิดทับ: วางบนรอยชั้นไม่ต่อเนื่องทับหินที่แก่กว่า เช่นตะกอน ศิลาแลง ลาวาบะซอลต์ ฐานลากตรงระหว่างจุดที่สัมผัสหินที่แก่กว่า', 'Cover: lies on an unconformity over older rock (sediment, laterite, a lava flow); its base runs straight between where it meets older rock'),
    intrusion: t('หินอัคนีแทรกซอน: ก้อนที่ผุดตัดผ่านชั้นหิน กว้างเท่าที่โผล่บนผิวดิน ผนังขยายออกเมื่อลึกลง', 'Intrusion: a body cutting up through the beds, as wide as it comes up, its walls widening downward'),
  });
  const roleHTML = (key) => {
    const r = model?.rocks.find((x) => x.key === key);
    if (!r) return '';
    const chosen = xs.ROLES.includes(cfg.roles[key]) ? cfg.roles[key] : 'auto';
    const guess = xs.autoRole(r.key.startsWith('c:') ? r.name : r.key);
    const what = ROLE_WHAT();
    const hint = chosen === 'auto'
      ? `${t(`อัตโนมัติ: แอปเลือก${xs.roleName(guess)} จากชื่อหิน`, `Auto: ${xs.roleName(guess)}, from the rock's name`)} · ${what[guess]}`
      : what[chosen];
    return `<div class="field"><span class="lbl">${t('หินนี้ในภาพตัดขวาง', 'This rock in the section')}</span>
      ${seg('role', chosen, [['auto', t('อัตโนมัติ', 'Auto')], ['layer', t('ชั้นหิน', 'Bed')], ['cover', t('ปิดทับ', 'Cover')], ['intrusion', t('แทรกซอน', 'Intrusion')]])}
      <p class="hint">${hint}</p></div>
      ${r.role === 'intrusion' ? `<div class="field"><span class="lbl">${t('ผนังของก้อนหิน (มุมจากแนวราบ)', 'Walls of the body (angle from horizontal)')}</span>
        ${seg('wall', r.wall, xs.WALLS.map((d) => [d, `${d}°`]))}
        <p class="hint">${t('90° ผนังตั้งตรง · มุมยิ่งน้อย ก้อนหินยิ่งขยายออกเมื่อลึกลง', '90° goes straight down · the smaller the angle, the more the body widens with depth')}</p></div>` : ''}`;
  };

  function openRock(key) {
    const r = model?.rocks.find((x) => x.key === key);
    if (!r) return;
    let sheet = null;
    const repaint = debounce(async () => {
      await refresh();
      if (!sheet?.isConnected) return; // the sheet was closed meanwhile
      sheet.querySelector('#xsRoleBox').innerHTML = roleHTML(key);
    }, 120);
    const ov = openOverlay(`<div class="sheet xs-sheet" role="dialog" aria-label="${esc(r.name)}">
      <div class="sheet-grip"></div>
      <h3>${rockName(r)}</h3>
      <p class="sheet-sub">${t('ใช้กับหินนี้ทุกจุดในภาพตัดขวาง สมุดบันทึกและสีหมุดบนแผนที่ไม่เปลี่ยน', 'Applies to this rock everywhere in the cross section; the notebook and the map pins stay as they are')}</p>
      <div id="xsRoleBox">${roleHTML(key)}</div>
      <div class="field"><span class="lbl">${t('สี', 'Colour')}</span>${colorHTML(key)}</div>
      <div class="btn-row one"><button type="button" class="btn-primary" data-close>${t('เสร็จ', 'Done')}</button></div>
    </div>`, {
      onClick: (e) => {
        const b = e.target.closest('.seg button');
        const k = b?.closest('.seg')?.dataset.k;
        if (k === 'role' || k === 'wall') {
          b.closest('.seg').querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
          if (k === 'wall') cfg.walls[key] = Number(b.dataset.v);
          else if (b.dataset.v === 'auto') delete cfg.roles[key];
          else cfg.roles[key] = b.dataset.v;
          save();
          repaint();
          return;
        }
        onColorClick(e, key, (c) => syncColor(ov.el, c));
      },
    });
    // listen on the sheet itself: #overlay is shared by every sheet and outlives this one
    sheet = ov.el.querySelector('.xs-sheet');
    sheet.addEventListener('input', (e) => {
      if (e.target.matches('input[type=color]')) { setColor(key, e.target.value); syncColor(sheet, e.target.value); }
    });
  }

  // ---------- station editor ----------
  function openEditor(id) {
    const st = stations.find((s) => s.id === id);
    if (!st || !st.location) return;
    const o = () => (cfg.over[id] ||= {});
    const tidy = () => { if (!xs.isEdited(cfg.over[id])) delete cfg.over[id]; };
    const e0 = xs.effective(st, cfg);
    const p0 = model?.pts.find((p) => p.st.id === id);
    const rocksHere = (model?.order || []).map((r) => r.key.startsWith('c:') ? r.name : r.key);
    const lithList = [...new Set([...rocksHere, ...LITHOLOGY.map(([en]) => en)])];
    const nbPlane = e0.nbPlane;
    const att = e0.plane;
    const contactRows = () => {
      if (!model) return '';
      const cs = model.contacts.filter((c) => c.a.st.id === id || c.b.st.id === id);
      return cs.map((c) => `<div class="field xs-contact" data-key="${esc(c.key)}">
        <span class="lbl">${t(`รอยสัมผัสระหว่าง ${esc(c.a.st.code)} กับ ${esc(c.b.st.code)}`, `Contact between ${esc(c.a.st.code)} and ${esc(c.b.st.code)}`)}</span>
        <input type="range" min="0" max="100" step="1" value="${Math.round(c.f * 100)}" data-o="contact" aria-label="${t('ตำแหน่งรอยสัมผัส', 'Contact position')}">
        <div class="xs-ends"><span>${esc(c.a.st.code)} · ${esc(c.a.rock)}</span><span>${esc(c.b.st.code)} · ${esc(c.b.rock)}</span></div>
      </div>`).join('');
    };
    const ov = openOverlay(`<div class="sheet xs-sheet" role="dialog" aria-label="${esc(st.code)}">
      <div class="sheet-grip"></div>
      <h3>${esc(st.code)}</h3>
      <p class="sheet-sub">${t('แก้เฉพาะในภาพตัดขวาง ข้อมูลในสมุดบันทึกไม่เปลี่ยน', 'Changes apply to the cross section only; the notebook stays as it is')}</p>
      <label class="xs-toggle"><input type="checkbox" data-o="use"${e0.skip ? '' : ' checked'}><span><b>${t('ใช้ข้อมูลจุดนี้', 'Use this station')}</b><small>${t('ปิดถ้าเป็นหินแปลกปลอม เช่นก้อนหินที่กลิ้งมา ไม่ใช่หินในที่', 'Switch off if the rock here was a loose block (float), not rock in place')}</small></span></label>
      ${cfg.line === 'strike'
        ? `<label class="xs-toggle"><input type="checkbox" data-o="path"${e0.offPath ? '' : ' checked'}><span><b>${t('ฉายจุดนี้ลงแนวตัด', 'Project onto the line')}</b><small>${p0 && Math.abs(p0.off) >= 1 ? t(`ห่างจากแนวตัด ${xs.distText(Math.abs(p0.off))} · `, `${xs.distText(Math.abs(p0.off))} from the line · `) : ''}${t('ปิดถ้าจุดนี้อยู่ไกลจากแนวมากจนข้อมูลไม่ตรงกับแนวนี้', 'Switch off if it lies so far from the line that its data do not apply there')}</small></span></label>`
        : `<label class="xs-toggle"><input type="checkbox" data-o="path"${e0.offPath ? '' : ' checked'}><span><b>${t('ให้แนวตัดผ่านจุดนี้', 'Section runs through here')}</b><small>${t('ปิดถ้าจุดนี้ออกนอกแนวเดินมาก', 'Switch off if this station is far off the line')}</small></span></label>`}
      <div class="field"><span class="lbl">${t('ชนิดหิน', 'Rock type')}</span>
        <input type="text" data-o="rock" value="${esc(e0.rock)}" list="xsLith" autocomplete="off" placeholder="${t('ไม่ระบุ', 'none')}">
        <datalist id="xsLith">${lithList.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        ${rocksHere.length ? `<div class="chips">${rocksHere.map((n) => `<button type="button" class="chip" data-rockpick="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
        <p class="hint">${t('ในสมุดบันทึก', 'In the notebook')}: ${e0.nbRock ? esc(e0.nbRock) : t('ไม่ระบุ', 'none')}</p>
      </div>
      <div class="field" id="xsColorField"><span class="lbl" id="xsColorLbl"></span><div id="xsColorBox"></div></div>
      <div class="field"><span class="lbl">${t('มุมเอียงของชั้นหิน (right-hand rule)', 'Bedding attitude (right-hand rule)')}</span>
        <label class="xs-toggle"><input type="checkbox" data-o="usedip"${cfg.over[id]?.noDip ? '' : ' checked'}><span><b>${t('ใช้มุมเอียงของจุดนี้', 'Use the dip here')}</b></span></label>
        <div class="meas-grid xs-att">
          <label><span>Strike</span><input type="text" inputmode="numeric" data-a="strike" value="${att ? trim1(att.strike) : ''}" placeholder="000" autocomplete="off"></label>
          <label><span>Dip</span><input type="text" inputmode="numeric" data-a="dip" value="${att ? trim1(att.dip) : ''}" placeholder="00" autocomplete="off"></label>
          <label><span>Dip dir</span><input type="text" inputmode="numeric" data-a="dipdir" value="${att ? trim1(att.dipdir) : ''}" placeholder="000" autocomplete="off"></label>
        </div>
        <p class="hint" id="xsAttHint"></p>
      </div>
      <div id="xsContacts">${contactRows()}</div>
      <div class="btn-row"><button type="button" class="btn" data-act="reset">${t('คืนค่าจากสมุดบันทึก', 'Back to the notebook')}</button><button type="button" class="btn-primary" data-close>${t('เสร็จ', 'Done')}</button></div>
    </div>`, {
      onClick: (e) => {
        const pick = e.target.closest('[data-rockpick]');
        if (pick) {
          const inp = ov.el.querySelector('[data-o=rock]');
          inp.value = pick.dataset.rockpick;
          setRock(inp.value);
          return;
        }
        const key = xs.rockGroup(xs.effective(st, cfg).rock);
        if (key && onColorClick(e, key, (c) => syncColor(ov.el, c))) return;
        if (e.target.closest('[data-act=reset]')) {
          rockLater.cancel(); // a rock name still being typed must not come back after the reset
          delete cfg.over[id];
          save();
          ov.close();
          refresh();
          toast(t(`${st.code} กลับเป็นค่าจากสมุดบันทึก`, `${st.code} is back to the notebook values`));
        }
      },
      onClose: () => { rockLater.flush(); save.flush(); },
    });
    // listen on the sheet itself: #overlay is shared by every sheet, so listeners added to it would
    // pile up and carry edits over to the next station opened
    const el = ov.el.querySelector('.xs-sheet');
    const paintColor = () => {
      const e = xs.effective(st, cfg);
      const rock = e.rock;
      const key = xs.rockGroup(rock);
      el.querySelector('#xsColorLbl').textContent = rock ? t(`สีของ ${rock} (ทุกจุดในภาพนี้)`, `Colour of ${rock} (everywhere in this picture)`) : t('สีของหิน', 'Rock colour');
      const why = !rock ? t('ใส่ชนิดหินก่อน', 'Enter a rock type first')
        : e.skip ? t('จุดนี้ปิดอยู่ หินนี้จึงไม่อยู่ในภาพ', 'This station is switched off, so its rock is not in the picture')
          : t('เลือกสีได้หลังภาพวาดหินนี้แล้ว', 'The colour can be picked once this rock is drawn');
      el.querySelector('#xsColorBox').innerHTML = key && model?.rocks.some((r) => r.key === key) ? colorHTML(key) : `<p class="hint">${why}</p>`;
    };
    const paintAttHint = () => {
      const p = model?.pts.find((x) => x.st.id === id);
      const nb = nbPlane ? `${plane(nbPlane)} (${nbPlane.type}${nbPlane.n > 1 ? t(` เฉลี่ย ${nbPlane.n} ค่า`, `, mean of ${nbPlane.n}`) : ''})` : t('ไม่มี', 'none');
      el.querySelector('#xsAttHint').innerHTML = `${t('ในสมุดบันทึก', 'In the notebook')}: ${nb}${p?.app != null ? ` · ${appText(p.app)}` : ''}`;
    };
    const after = debounce(async () => {
      await refresh();
      if (!el.isConnected) return; // the sheet was closed meanwhile
      paintColor();
      paintAttHint();
      const box3 = el.querySelector('#xsContacts');
      if (box3 && !box3.contains(document.activeElement)) box3.innerHTML = contactRows();
    }, 200);
    const setRock = (v) => {
      const s = String(v || '').trim();
      if (s === e0.nbRock) delete o().rock; else o().rock = s;
      tidy();
      save();
      after();
    };
    // typing: wait for a pause, so half-typed names do not become rocks of their own
    const rockLater = debounce(setRock, 700);
    paintColor();
    paintAttHint();

    el.addEventListener('input', (e) => {
      const tg = e.target;
      const k = tg.dataset.o;
      if (k === 'rock') { rockLater(tg.value); return; }
      if (k === 'color') {
        const key = xs.rockGroup(xs.effective(st, cfg).rock);
        if (key) { setColor(key, tg.value); syncColor(el, tg.value); }
        return;
      }
      if (k === 'contact') {
        const c = model?.contacts.find((x) => x.key === tg.closest('.xs-contact')?.dataset.key);
        if (!c) return;
        const f = Number(tg.value) / 100;
        cfg.contacts[c.key] = c.lowFirst ? f : 1 - f;
        save();
        redraw();
        return;
      }
      if (tg.dataset.a) {
        const grid = el.querySelector('.xs-att');
        const val = (n) => parseNum(grid.querySelector(`[data-a=${n}]`).value);
        const v = parseNum(tg.value);
        const okv = v === null || (!Number.isNaN(v) && v >= 0 && v <= (tg.dataset.a === 'dip' ? 90 : 360));
        tg.classList.toggle('invalid', !okv);
        if (!okv) return;
        if (tg.dataset.a === 'strike' && v !== null) grid.querySelector('[data-a=dipdir]').value = trim1(strikeToDipDir(v % 360));
        if (tg.dataset.a === 'dipdir' && v !== null) grid.querySelector('[data-a=strike]').value = trim1(dipDirToStrike(v % 360));
        const dip = val('dip'), dd = val('dipdir');
        const same = nbPlane && dip != null && dd != null && Math.abs(dip - nbPlane.dip) < 0.05 && Math.abs(((dd - nbPlane.dipdir + 540) % 360) - 180) < 0.05;
        if (dip == null && dd == null && val('strike') == null) delete o().att;
        else if (same) delete o().att;
        else if (dip != null && !Number.isNaN(dip) && dd != null && !Number.isNaN(dd)) o().att = { dip, dipdir: norm360(dd), strike: dipDirToStrike(dd) };
        else return;
        tidy();
        save();
        after();
      }
    });
    el.addEventListener('change', (e) => {
      const tg = e.target;
      if (tg.dataset.o === 'rock') { rockLater.cancel(); setRock(tg.value); return; }
      if (tg.dataset.o === 'use') { if (tg.checked) delete o().skip; else o().skip = true; }
      else if (tg.dataset.o === 'path') { if (tg.checked) delete o().offPath; else o().offPath = true; }
      else if (tg.dataset.o === 'usedip') { if (tg.checked) delete o().noDip; else o().noDip = true; }
      else return;
      tidy();
      save();
      after();
    });
  }

  // ---------- events ----------
  canvas.addEventListener('click', (e) => {
    if (!shown) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * shown.width;
    const y = ((e.clientY - r.top) / r.height) * shown.height;
    let best = null, bd = 30 * 30;
    for (const m of shown.marks) {
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    if (best) openEditor(best.id);
  });

  root.addEventListener('click', (e) => {
    const row = e.target.closest('.xs-row');
    if (row) { openEditor(row.dataset.id); return; }
    const rk = e.target.closest('[data-rock]');
    if (rk) { openRock(rk.dataset.rock); return; }
    if (e.target.closest('#xsRetry')) { sig = null; refresh({ forceGround: true }); return; }
    if (e.target.closest('#veAuto')) { cfg.ve = 'auto'; save(); redraw(); return; }
    if (e.target.closest('#xsReset')) {
      if (!confirm(t('ล้างการแก้ไขทั้งหมดในภาพตัดขวางนี้? (สมุดบันทึกไม่เปลี่ยน)', 'Clear every change in this cross section? (The notebook is not affected.)'))) return;
      cfg.over = {}; cfg.contacts = {}; cfg.colors = {}; cfg.roles = {}; cfg.walls = {};
      save();
      refresh();
      return;
    }
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.closest('.seg');
    group.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    const k = group.dataset.k;
    const v = b.dataset.v;
    if (k === 'depth') cfg.depth = v === 'auto' ? 'auto' : Number(v);
    else if (k === 'line') cfg.line = v === 'strike' ? 'strike' : 'path';
    else if (k === 'under') cfg.under = v === 'true';
    else if (k === 'flip') cfg.flip = v === 'true';
    else if (k === 'zoom') cfg.zoom = Number(v) || 1;
    save();
    redraw();
  });
  q('#veRange').addEventListener('input', (e) => {
    cfg.ve = xs.NICE_VE[Number(e.target.value)] || 1;
    q('#veOut').textContent = `×${cfg.ve}`;
    q('#veAuto').setAttribute('aria-pressed', 'false');
    save();
    redraw();
  });

  q('#xsShare').onclick = async () => {
    if (!model) return;
    const btn = q('#xsShare');
    btn.disabled = true;
    try {
      const c = document.createElement('canvas');
      await xs.renderSection(c, model, { mode: 'export', ratio: 1.5, ve: cfg.ve, depth: cfg.depth, under: cfg.under !== false, project, demCredit: ground.src === 'dem' ? demRes.source.credit : '' });
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const name = `GeoNote_Section_${project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_${stamp()}.png`;
      const res = await deliver(new File([blob], name, { type: 'image/png' }));
      if (res === 'downloaded') toast(t('บันทึกรูปแล้ว', 'Picture saved'));
      else if (res === 'shared') toast(t('แชร์รูปแล้ว', 'Picture shared'));
    } catch (err) {
      toast(`${t('สร้างรูปไม่สำเร็จ', 'Could not make the picture')}: ${err.message}`, 4000);
    } finally {
      btn.disabled = false;
    }
  };

  // redraw when the screen width changes; try the DEM again when the internet comes back
  let lastW = box.clientWidth;
  const onResize = debounce(() => { if (box.clientWidth !== lastW) { lastW = box.clientWidth; draw(); } }, 250);
  const onOnline = () => { if (ground && ground.src !== 'dem') { sig = null; refresh({ forceGround: true }); } };
  window.addEventListener('resize', onResize);
  window.addEventListener('online', onOnline);

  await refresh();
  return () => {
    job += 1;
    save.flush();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('online', onOnline);
  };
}
