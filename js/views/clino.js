// Strike/dip from the phone's sensors, and the zero calibration for the camera bump.
//
// Lay the back of the phone flat on the bedding surface. When the readings stay still for
// 1.5 seconds the value locks (vibrates and beeps); then save it to the station. Right-hand rule:
// dip direction is 90° clockwise from strike.

import * as attitude from '../attitude.js';
import * as store from '../store.js';
import { openOverlay, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, uuid } from '../util.js';
import { STRUCTURE_TYPES } from '../vocab.js';
import { az3, cardinal, norm360 } from '../geomath.js';
import { t, isEn } from '../i18n.js';

const STATUS_TEXT = {
  get 'needs-permission'() { return t('แตะ อนุญาตเซนเซอร์ เพื่อเริ่มวัด', 'Tap Allow sensor to start measuring'); },
  get waiting() { return t('กำลังอ่านเซนเซอร์', 'Reading the sensor'); },
  get unavailable() { return t('เครื่องนี้ไม่มีเซนเซอร์วัดการเอียง ใช้ กรอกเอง แทน', 'This device has no tilt sensor. Use Type in instead.'); },
  get denied() { return t('ไม่ได้รับสิทธิ์ใช้เซนเซอร์ ปิดแอปแล้วเปิดใหม่ แล้วแตะอนุญาตอีกครั้ง', 'Sensor permission refused. Close and reopen the app, then allow it again.'); },
  get off() { return t('กำลังอ่านเซนเซอร์', 'Reading the sensor'); },
};

/** Short vibration and beep, so you know it locked while the phone is pressed on the rock. */
function makeSignal() {
  let ac = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { ac = new AC(); ac.resume?.(); }
  } catch { ac = null; }
  const play = () => {
    try { navigator.vibrate?.(80); } catch { /* not supported */ }
    if (!ac) return;
    try {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 1320;
      g.gain.value = 0.0001;
      o.connect(g).connect(ac.destination);
      const t = ac.currentTime;
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.start(t);
      o.stop(t + 0.15);
    } catch { /* audio blocked */ }
  };
  play.close = () => { try { ac?.close(); } catch { /* ignore */ } };
  return play;
}

/** North-up dial (map view) with the strike/dip symbol, like the design: 000 / 090 / 180 / 270. */
function dialSVG() {
  let ticks = '';
  for (let d = 0; d < 360; d += 5) {
    const major = d % 30 === 0;
    const r1 = 92, r2 = major ? 81 : d % 10 === 0 ? 86 : 88.5;
    const a = (d * Math.PI) / 180;
    ticks += `<line class="${major ? 'tick major' : 'tick'}" x1="${(100 + r1 * Math.sin(a)).toFixed(2)}" y1="${(100 - r1 * Math.cos(a)).toFixed(2)}" x2="${(100 + r2 * Math.sin(a)).toFixed(2)}" y2="${(100 - r2 * Math.cos(a)).toFixed(2)}"/>`;
  }
  const lab = [[0, '000'], [90, '090'], [180, '180'], [270, '270']].map(([d, t]) => {
    const a = (d * Math.PI) / 180;
    return `<text class="${d === 0 ? 'n' : ''}" x="${(100 + 68 * Math.sin(a)).toFixed(1)}" y="${(100 - 68 * Math.cos(a)).toFixed(1)}">${t}</text>`;
  }).join('');
  return `<svg class="cl-dial" viewBox="-6 -14 212 220" aria-hidden="true">
    <circle class="ring" cx="100" cy="100" r="92"/>
    ${ticks}
    <path class="north" d="M100 -12 L106 0 L94 0 Z"/>
    <text class="nl" x="100" y="-4"></text>
    ${lab}
    <g id="clSym" class="sym idle" transform="rotate(0 100 100)">
      <line x1="100" y1="34" x2="100" y2="166"/>
      <line x1="100" y1="100" x2="128" y2="100"/>
    </g>
    <circle class="hub" cx="100" cy="100" r="3.2"/>
    <text id="clDipLbl" class="diplbl" x="100" y="100"></text>
  </svg>`;
}

/**
 * Open the measuring screen.
 * @param {{type?: string, allowMore?: boolean, onSave: (m: object) => (void|Promise<void>)}} o
 */
export function openClino({ type = 'Bedding', allowMore = true, onSave }) {
  // iPhone: the permission prompt has to come from this tap, before anything else waits.
  const perm = attitude.needsPermission() ? attitude.requestPermission() : null;
  const signal = makeSignal();
  const settings = store.getSettings();
  const decl = Number(settings.declination) || 0;
  const cal = settings.clinoCal?.c?.length === 3 ? settings.clinoCal : null;
  const contact = cal ? cal.c : [0, 0, 1];

  let curType = STRUCTURE_TYPES.some(([en]) => en === type) ? type : 'Bedding';
  let locked = null; // { plane, normal, spread, n, north, accuracy }
  let armedFrom = null; // after "save and next": wait until the phone moves to another plane
  let saved = 0;
  let last = null; // latest live reading
  let sensor = 'waiting'; // attitude status
  let frame = 0;
  const steady = new attitude.Steady({ tol: 1.0, anchorTol: 1.6, hold: 1500 });

  const chips = STRUCTURE_TYPES.map(([en, th]) =>
    `<button type="button" class="chip${en === curType ? ' on' : ''}" data-type="${esc(en)}" aria-pressed="${en === curType}">${esc(en)}${isEn() ? '' : `<i>${esc(th)}</i>`}</button>`).join('');

  const { el, close } = openOverlay(`<div class="clino" role="dialog" aria-label="${t('วัด Strike/Dip ด้วยเซนเซอร์', 'Measure strike/dip with the sensor')}">
      <header class="cl-head">
        <button type="button" class="icon-btn" data-close aria-label="${t('ปิด', 'Close')}">${icon('close')}</button>
        <div><b>${t('วัดด้วยเซนเซอร์', 'Sensor measurement')}</b><small id="clRef"></small></div>
        <span class="cl-count" id="clCount"></span>
      </header>
      <div class="cl-types" role="group" aria-label="${t('ชนิดโครงสร้าง', 'Structure type')}">${chips}</div>
      <div class="cl-body">
        ${dialSVG()}
        <div class="cl-read">
          <div><span>Strike</span><b id="clStrike">—</b></div>
          <div><span>Dip</span><b id="clDip">—</b></div>
          <div><span>Dip dir</span><b id="clDd">—</b></div>
        </div>
        <p class="cl-note mono" id="clNote"></p>
        <div class="cl-steady"><div class="progress"><i id="clBar"></i></div><p id="clMsg">${t('วางหลังมือถือแนบกับผิวชั้นหิน', 'Lay the back of the phone flat on the bedding surface')}</p></div>
        <p class="cl-warn hidden" id="clWarn"></p>
      </div>
      <div class="cl-actions" id="clActions"></div>
    </div>`, {
    cls: 'full',
    onClose: () => { unsub(); cancelAnimationFrame(frame); signal.close(); },
    onClick: async (e) => {
      const chip = e.target.closest('[data-type]');
      if (chip) {
        curType = chip.dataset.type;
        el.querySelectorAll('[data-type]').forEach((c) => {
          const on = c === chip;
          c.classList.toggle('on', on);
          c.setAttribute('aria-pressed', String(on));
        });
        return;
      }
      const b = e.target.closest('[data-cl]');
      if (!b || b.disabled) return;
      const act = b.dataset.cl;
      if (act === 'perm') {
        attitude.requestPermission();
      } else if (act === 'lock') {
        const s = steady.status();
        if (!last) return;
        doLock(s.n >= 5 ? s : { mean: steady.recentMean(500) || last.normal, spread: null, n: 1 });
      } else if (act === 'again') {
        locked = null;
        armedFrom = null;
        steady.reset();
        renderActions();
        paint();
      } else if (act === 'save' || act === 'next') {
        if (!locked) return;
        const m = record();
        try {
          await onSave(m);
        } catch (err) {
          toast(t(`บันทึกไม่สำเร็จ: ${err.message}`, `Could not save: ${err.message}`), 4000);
          return;
        }
        saved += 1;
        if (act === 'save') {
          toast(t(`บันทึก ${m.type} ${m.strike != null ? az3(m.strike) : '—'}/${m.dip} แล้ว`, `${m.type} ${m.strike != null ? az3(m.strike) : '—'}/${m.dip} saved`));
          close();
          return;
        }
        toast(t(`บันทึกค่าที่ ${saved} แล้ว ย้ายไปวางบนระนาบถัดไป`, `Reading ${saved} saved. Move to the next surface.`));
        armedFrom = locked.normal;
        locked = null;
        steady.reset();
        renderActions();
        paint();
        $('clCount').textContent = t(`บันทึกแล้ว ${saved} ค่า`, `${saved} saved`);
      }
    },
  });

  const $ = (id) => el.querySelector(`#${id}`);
  $('clRef').textContent = `${decl ? t(`ทิศเหนือจริง (declination ${decl > 0 ? '+' : ''}${decl}°)`, `True north (declination ${decl > 0 ? '+' : ''}${decl}°)`) : t('ทิศเหนือแม่เหล็ก', 'Magnetic north')} · ${cal ? t('ปรับศูนย์แล้ว', 'zeroed') : t('ยังไม่ได้ปรับศูนย์', 'not zeroed')}`;

  function record() {
    const p = locked.plane;
    const dip = Math.round(p.dip);
    const dipdir = locked.north ? Math.round(p.dipdir) % 360 : null;
    return {
      id: uuid(),
      type: curType,
      strike: dipdir == null ? null : norm360(dipdir - 90),
      dip,
      dipdir,
      src: 'sensor',
      sensor: {
        at: Date.now(),
        n: locked.n,
        spread: locked.spread == null ? null : Math.round(locked.spread * 10) / 10,
        north: locked.north,
        declination: decl,
        calibrated: !!cal,
        compassAcc: locked.accuracy,
        platform: last?.ios ? 'ios' : 'android',
      },
    };
  }

  function doLock(s) {
    if (!s.mean || !last) return;
    locked = { plane: attitude.planeFromNormal(s.mean), normal: s.mean, spread: s.spread, n: s.n, north: last.north, accuracy: last.accuracy };
    signal();
    renderActions();
    paint();
  }

  function renderActions() {
    const box = $('clActions');
    if (!locked && sensor === 'needs-permission') {
      box.innerHTML = `<button type="button" class="btn-primary xl" data-cl="perm">${icon('check')}<span>${t('อนุญาตเซนเซอร์', 'Allow sensor')}</span></button>`;
      return;
    }
    if (!locked) {
      box.innerHTML = sensor === 'ok'
        ? `<button type="button" class="btn-secondary" data-cl="lock">${icon('check')}<span>${t('ล็อกค่านี้', 'Lock this')}</span></button>`
        : '';
      return;
    }
    box.innerHTML = `<div class="cl-row">
        <button type="button" class="btn-secondary" data-cl="again">${icon('refresh')}<span>${t('วัดใหม่', 'Measure again')}</span></button>
        ${allowMore ? `<button type="button" class="btn-secondary" data-cl="next">${icon('plus')}<span>${t('บันทึก แล้ววัดต่อ', 'Save and measure another')}</span></button>` : ''}
      </div>
      <button type="button" class="btn-primary xl" data-cl="save">${icon('check')}<span>${t('บันทึกค่านี้', 'Save this reading')}</span></button>`;
  }

  function showPlane(p, north) {
    const flat = p.dip < 0.5;
    $('clStrike').textContent = north && !flat ? `${az3(Math.round(p.strike) % 360)}°` : '—';
    $('clDip').textContent = `${Math.round(p.dip)}°`;
    $('clDd').textContent = north && !flat ? `${az3(Math.round(p.dipdir) % 360)}°` : '—';
    $('clNote').textContent = north && !flat
      ? `${az3(norm360(Math.round(p.dipdir) - 90))}/${Math.round(p.dip)}  ${t('เทไปทาง', 'dipping')} ${cardinal(p.dipdir)}`
      : flat ? t('ระนาบเกือบราบ', 'Nearly flat') : `Dip ${Math.round(p.dip)}°`;
    const sym = $('clSym');
    sym.setAttribute('transform', `rotate(${(north ? p.strike : 0).toFixed(1)} 100 100)`);
    sym.classList.toggle('idle', !north || flat);
    const lbl = $('clDipLbl');
    if (north && !flat) {
      const a = (p.dipdir * Math.PI) / 180;
      lbl.setAttribute('x', (100 + 44 * Math.sin(a)).toFixed(1));
      lbl.setAttribute('y', (100 - 44 * Math.cos(a)).toFixed(1));
      lbl.textContent = String(Math.round(p.dip));
    } else lbl.textContent = '';
  }

  function warnFor(p, north, accuracy) {
    if (!north) return t('อ่านทิศเหนือจากเครื่องนี้ไม่ได้ วัดได้เฉพาะ Dip', 'This device cannot read north, so only dip can be measured');
    if (accuracy != null && accuracy > 15) return t(`เข็มทิศคลาดเคลื่อน ±${Math.round(accuracy)}° หมุนมือถือเป็นเลข 8 แล้ววัดใหม่ และอยู่ห่างค้อนหรือเหล็ก`, `Compass uncertain ±${Math.round(accuracy)}°. Move the phone in a figure 8, measure again, and keep away from hammers and steel.`);
    if (p && p.dip < 3) return t('ชั้นเกือบราบ ทิศเทของชั้นอาจคลาดเคลื่อนมาก ควรวางบนสมุดหรือแผ่นแข็งที่แนบผิวชั้น', 'Nearly flat bed: the dip direction may be far off. Lay a notebook or board on the surface first.');
    if (p && p.dip > 80) return t('ชั้นชันมาก ควรตรวจค่ากับเข็มทิศธรณีอีกครั้ง', 'Very steep bed: check the reading with a geological compass.');
    return '';
  }

  function paint() {
    frame = 0;
    const warn = $('clWarn');
    if (locked) {
      showPlane(locked.plane, locked.north);
      $('clBar').style.width = '100%';
      $('clMsg').textContent = t(`ล็อกค่าแล้ว${locked.spread != null ? ` (ค่ากระจาย ${locked.spread.toFixed(1)}°)` : ''}`, `Locked${locked.spread != null ? ` (spread ${locked.spread.toFixed(1)}°)` : ''}`);
      el.querySelector('.clino').classList.add('locked');
      const w = warnFor(locked.plane, locked.north, locked.accuracy);
      warn.textContent = w;
      warn.classList.toggle('hidden', !w);
      return;
    }
    el.querySelector('.clino').classList.remove('locked');
    if (!last) return;
    const live = steady.recentMean(300) || last.normal;
    const p = attitude.planeFromNormal(live);
    showPlane(p, last.north);
    const s = steady.status();
    $('clBar').style.width = `${Math.round((armedFrom ? 0 : s.progress) * 100)}%`;
    $('clMsg').textContent = armedFrom ? t('ยกมือถือไปวางบนระนาบถัดไป', 'Move the phone to the next surface') : s.progress > 0.15 ? t('ถือนิ่ง ๆ', 'Hold still') : t('วางหลังมือถือแนบกับผิวชั้นหิน', 'Lay the back of the phone flat on the bedding surface');
    const w = warnFor(p, last.north, last.accuracy);
    warn.textContent = w;
    warn.classList.toggle('hidden', !w);
  }

  const unsub = attitude.subscribe((a) => {
    const prev = sensor;
    sensor = a.status === 'ok' && a.sample ? 'ok' : a.status;
    if (sensor !== prev) renderActions();
    if (sensor !== 'ok') {
      last = null;
      $('clMsg').textContent = STATUS_TEXT[a.status] || '';
      return;
    }
    const s = a.sample;
    const R = attitude.sampleRotation(s, decl);
    const normal = attitude.apply(R, contact);
    last = { normal, north: s.north, accuracy: s.accuracy, ios: s.ios };
    if (locked) return;
    if (armedFrom) {
      if (attitude.angleBetween(normal, armedFrom) < 4) {
        if (!frame) frame = requestAnimationFrame(paint);
        return;
      }
      armedFrom = null;
      steady.reset();
    }
    const st = steady.push(s.t, normal);
    if (st.progress >= 1 && st.n >= 8) doLock(st);
    else if (!frame) frame = requestAnimationFrame(paint);
  });

  renderActions();
  perm?.then((res) => { if (res !== 'granted') $('clMsg').textContent = STATUS_TEXT.denied; });
  return close;
}

/**
 * Zero calibration: two readings on a flat table with the phone turned 180° in between.
 * The average cancels the table's own tilt and leaves the tilt of the phone's back (camera bump).
 */
export function openCalibration({ onDone } = {}) {
  const perm = attitude.needsPermission() ? attitude.requestPermission() : null;
  const signal = makeSignal();
  const steady = new attitude.Steady({ tol: 0.25, anchorTol: 0.5, hold: 2000 });
  let step = 1;
  let first = null; // { up, yaw }
  let result = null;

  const { el, close } = openOverlay(`<div class="sheet cal-sheet" role="dialog" aria-label="${t('ปรับศูนย์เซนเซอร์วัดชั้นหิน', 'Zero the strike/dip sensor')}">
      <div class="sheet-grip"></div>
      <h3>${t('ปรับศูนย์เซนเซอร์', 'Zero the sensor')}</h3>
      <p class="sheet-sub">${t('หาค่าเอียงของหลังมือถือ (กล้องนูน เคส) แล้วแก้ให้ทุกการวัด', 'Finds the tilt of the phone back (camera bump, case) and corrects every reading')}</p>
      <ol class="cal-steps">
        <li id="cal1">${t('วางมือถือหงายหน้าจอขึ้นบนโต๊ะหรือพื้นเรียบที่แข็ง แล้วปล่อยมือ', 'Lay the phone screen-up on a hard flat table and let go')}</li>
        <li id="cal2">${t('หมุนมือถือกลับหัว 180° (หัวเครื่องไปอยู่ฝั่งที่เคยเป็นท้ายเครื่อง) วางที่จุดเดิม แล้วปล่อยมือ', 'Turn it round 180° (top where the bottom was), put it in the same place and let go')}</li>
      </ol>
      <div class="progress"><i id="calBar"></i></div>
      <p class="cal-msg" id="calMsg">${t('กำลังอ่านเซนเซอร์', 'Reading the sensor')}</p>
      <div class="cal-actions" id="calActions"><button type="button" class="btn block" data-close>${t('ยกเลิก', 'Cancel')}</button></div>
    </div>`, {
    onClose: () => { unsub(); signal.close(); },
    onClick: async (e) => {
      const b = e.target.closest('[data-cal]');
      if (!b) return;
      if (b.dataset.cal === 'save' && result) {
        await store.updateSettings({ clinoCal: { c: result.c, tilt: Math.round(result.tilt * 100) / 100, at: Date.now() } });
        toast(t(`ปรับศูนย์แล้ว เครื่องเอียง ${result.tilt.toFixed(1)}°`, `Zeroed. The phone back tilts ${result.tilt.toFixed(1)}°`));
        close();
        onDone?.();
      } else if (b.dataset.cal === 'redo') {
        step = 1; first = null; result = null; steady.reset();
        render();
      } else if (b.dataset.cal === 'perm') {
        attitude.requestPermission();
      }
    },
  });
  const $ = (id) => el.querySelector(`#${id}`);

  function render(msg) {
    $('cal1').className = step === 1 ? 'on' : 'done';
    $('cal2').className = step === 2 ? 'on' : step > 2 ? 'done' : '';
    if (msg) $('calMsg').textContent = msg;
    if (step === 3 && result) {
      const odd = result.tilt > 6;
      $('calBar').style.width = '100%';
      $('calMsg').innerHTML = odd
        ? t(`หลังมือถือเอียง ${result.tilt.toFixed(1)}° มากผิดปกติ ตรวจว่าวางบนพื้นเรียบแล้วทำใหม่`, `The phone back tilts ${result.tilt.toFixed(1)}°, which is unusually large. Check the surface is flat and try again.`)
        : t(`หลังมือถือเอียง <b>${result.tilt.toFixed(1)}°</b> เมื่อวางบนพื้นเรียบ (โต๊ะเอียง ${result.table.toFixed(1)}°) GeoNote จะหักค่านี้ออกทุกครั้งที่วัด`, `The phone back tilts <b>${result.tilt.toFixed(1)}°</b> on a flat surface (table tilt ${result.table.toFixed(1)}°). GeoNote will remove this from every reading.`);
      $('calActions').innerHTML = `<button type="button" class="btn" data-cal="redo">${t('ทำใหม่', 'Again')}</button>
        ${odd ? '' : `<button type="button" class="btn-primary" data-cal="save">${icon('check')}<span>${t('บันทึก', 'Save')}</span></button>`}`;
    }
  }

  const unsub = attitude.subscribe((a) => {
    if (step === 3) return;
    if (a.status !== 'ok' || !a.sample) {
      if (a.status === 'needs-permission') $('calActions').innerHTML = `<button type="button" class="btn-primary block" data-cal="perm">${icon('check')}<span>${t('อนุญาตเซนเซอร์', 'Allow sensor')}</span></button>`;
      render(STATUS_TEXT[a.status] || '');
      return;
    }
    if (!$('calActions').querySelector('[data-close]')) $('calActions').innerHTML = `<button type="button" class="btn block" data-close>${t('ยกเลิก', 'Cancel')}</button>`;
    const s = a.sample;
    const up = attitude.upInPhone(s.beta, s.gamma);
    if (step === 2 && first && s.yaw != null && first.yaw != null) {
      const turned = (((s.yaw - first.yaw) % 360) + 360) % 360;
      if (Math.abs(turned - 180) > 35) { // not yet turned round
        steady.reset();
        $('calBar').style.width = '0%';
        render(t('หมุนมือถือกลับหัว 180° แล้ววางที่จุดเดิม', 'Turn the phone round 180° and put it in the same place'));
        return;
      }
    }
    const st = steady.push(s.t, up);
    $('calBar').style.width = `${Math.round(st.progress * 100)}%`;
    if (st.progress < 1 || st.n < 10) {
      render(st.progress > 0.1 ? t('อย่าแตะมือถือ กำลังอ่านค่า', 'Do not touch the phone, reading') : step === 1 ? t('วางมือถือบนพื้นเรียบแล้วปล่อยมือ', 'Lay the phone on a flat surface and let go') : t('วางที่จุดเดิมแล้วปล่อยมือ', 'Put it in the same place and let go'));
      return;
    }
    signal();
    if (step === 1) {
      first = { up: st.mean, yaw: s.yaw };
      step = 2;
      steady.reset();
      $('calBar').style.width = '0%';
      render(t('หมุนมือถือกลับหัว 180° แล้ววางที่จุดเดิม', 'Turn the phone round 180° and put it in the same place'));
    } else {
      result = attitude.calibrationFromPair(first.up, st.mean);
      step = 3;
      render();
    }
  });
  render();
  perm?.then((res) => { if (res !== 'granted') render(STATUS_TEXT.denied); });
  return close;
}
