// Settings — current project, coordinates, GPS, permissions, display, storage.

import * as store from '../store.js';
import { mainHeader, toast, applyTheme } from '../ui.js';
import { icon } from '../icons.js';
import { openCalibration } from './clino.js';
import * as offline from '../offlinemap.js';
import * as geol from '../geology.js';
import { THEMES, DEFAULT_THEME, themeName, themeDesc } from '../themes.js';
import { downloadRegion } from './offline-dl.js';
import { REGIONS, regionById, regionName, regionNote, manifest } from '../regions.js';
import { esc, debounce, fmtSize, parseNum, isStandalone, isIOS } from '../util.js';
import { t, getLang, setLang, LANGS } from '../i18n.js';

const seg = (key, value, options) =>
  `<div class="seg" role="radiogroup" data-k="${key}">${options
    .map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;

export async function render(root) {
  mainHeader();
  const s = store.getSettings();
  const p = store.getProject();
  const example = () => {
    const cur = store.getProject();
    return t(`รหัสจะเป็นแบบ Station ${esc(cur.stationPrefix)}-001 และตัวอย่างหิน ${esc(cur.samplePrefix)}-001-01`, `Codes will look like station ${esc(cur.stationPrefix)}-001 and sample ${esc(cur.samplePrefix)}-001-01`);
  };

  root.innerHTML = `<div class="screen page settings-screen">
    <section class="sec">
      <h2 class="sec-h">Project <a class="btn sm" href="#/projects">${icon('folder')}${t('โปรเจกต์ทั้งหมด', 'All projects')}</a></h2>
      <label class="field"><span class="lbl">${t('ชื่อโปรเจกต์ที่ใช้อยู่', 'Current project name')}</span><input type="text" data-k="projectName" value="${esc(p.name)}" autocomplete="off"></label>
      <div class="field-2">
        <label class="field"><span class="lbl">Station prefix</span><input type="text" class="mono" data-k="stationPrefix" value="${esc(p.stationPrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
        <label class="field"><span class="lbl">Sample prefix</span><input type="text" class="mono" data-k="samplePrefix" value="${esc(p.samplePrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
      </div>
      <p class="hint" id="idExample">${example()}</p>
      <p class="warn-text hidden" id="prefixWarn"></p>
      <label class="field"><span class="lbl">${t('ผู้เก็บข้อมูล (Collector) ใช้กับทุกโปรเจกต์', 'Collector (used for every project)')}</span><input type="text" data-k="collector" value="${esc(s.collector)}" placeholder="${t('ชื่อ นามสกุล', 'Full name')}" autocomplete="name"></label>
    </section>

    <section class="sec">
      <h2 class="sec-h">Coordinates</h2>
      <div class="field"><span class="lbl">${t('แสดงพิกัดเป็น', 'Show coordinates as')}</span>${seg('coordFormat', s.coordFormat, [['utm', 'Grid Ref'], ['dd', 'Lat/Long'], ['dms', 'DMS']])}</div>
      <div class="field"><span class="lbl">UTM zone</span>${seg('utmZone', s.utmZone, [['auto', 'Auto'], ['47', '47'], ['48', '48']])}</div>
      <p class="hint">${t('Grid Ref คือพิกัดกริด 6 หลักแบบที่ใช้ปักบนแผนที่ภูมิประเทศ 1:50,000 (ช่องละ 100 m) ตัวอักษรเช่น 48Q TD คือรหัสโซนและจัตุรัส 100 km ที่พิมพ์ไว้ขอบระวาง', 'Grid Ref is the 6-figure grid reference used to plot on 1:50,000 topographic maps (100 m squares). Letters such as 48Q TD are the zone and 100 km square printed in the map margin.')}</p>
      <p class="hint">${t('ประเทศไทยคร่อม UTM สองโซน: 47 อยู่ทางตะวันตกของลองจิจูด 102° และ 48 อยู่ทางตะวันออก ถ้าพื้นที่สำรวจคร่อมเส้นแบ่ง ให้ล็อกโซนเดียวทั้งโปรเจกต์ ไฟล์ Export มีทั้ง UTM และ Lat/Long เสมอ', 'Thailand spans two UTM zones: 47 west of longitude 102° and 48 east of it. If your area crosses the line, lock one zone for the whole project. Exports always include both UTM and Lat/Long.')}</p>
      <label class="field"><span class="lbl">${t('Magnetic declination (องศา, ตะวันออกเป็นบวก)', 'Magnetic declination (degrees, east positive)')}</span><input type="text" inputmode="decimal" class="mono" data-k="declination" value="${esc(s.declination)}" autocomplete="off"></label>
      <p class="hint">${t('ใส่ 0 เพื่อแสดงทิศเหนือแม่เหล็กเหมือนเข็มทิศ Brunton ที่ไม่ได้ตั้งค่า', 'Enter 0 to show magnetic north, like a Brunton with no declination set.')}</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">GPS</h2>
      <div class="field"><span class="lbl">${t('ปิด GPS เมื่อได้ความแม่นยำ', 'Turn the GPS off at accuracy')}</span>${seg('gpsTarget', s.gpsTarget, [['5', '±5 m'], ['10', '±10 m'], ['20', '±20 m']])}</div>
      <p class="hint">${t('GeoNote เปิด GPS เฉพาะตอนแตะ ดูตำแหน่ง หรือสร้าง Station ใหม่ แล้วปิดทันทีเมื่อได้ค่าตามนี้ หรือครบ 30 วินาที (แตะ ใช้ค่านี้ เพื่อหยุดก่อนได้) ตั้งค่าสูงขึ้นจะปิดเร็วขึ้นและประหยัดแบตกว่า', 'GeoNote turns the GPS on only when you tap Locate or create a station, and off again as soon as it reaches this accuracy or after 30 seconds (tap Use this to stop sooner). A larger value stops sooner and saves battery.')}</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">Smart Photo</h2>
      <div class="field"><span class="lbl">${t('บันทึก Smart Photo ลงเครื่องเมื่อบันทึก Station', 'Save Smart Photos to the phone when a station is saved')}</span>${seg('smartAutoSave', s.smartAutoSave === false ? 'off' : 'on', [['on', t('อัตโนมัติ', 'Automatically')], ['off', t('ไม่บันทึก', 'Do not save')]])}</div>
      <p class="hint">${t('Smart Photo ของทุกรูปถูกเก็บไว้ในแอปเสมอ', 'Every photo always keeps its Smart Photo in the app.')} ${isIOS() ? t('บน iPhone เว็บแอปบันทึกรูปลงเครื่องเองไม่ได้ ให้แตะรูปแล้วกด Smart Photo → บันทึกหรือแชร์ → Save Image หรือใช้ EXPORT → Smart Photos ทีเดียวทั้งโปรเจกต์', 'On iPhone a web app cannot save photos by itself: tap a photo, then Smart Photo → Save or share → Save Image, or use EXPORT → Smart Photos for the whole project.') : t('เมื่อกด SAVE STATION รูปใหม่จะถูกบันทึกลงโฟลเดอร์ Download ของเครื่อง (เห็นในแกลเลอรี)', 'When you tap SAVE STATION, new photos are saved to the Download folder (visible in the gallery).')}</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">${t('เซนเซอร์วัดชั้นหิน', 'Strike/dip sensor')}</h2>
      <div id="calBox"></div>
    </section>

    <section class="sec">
      <h2 class="sec-h">${t('สิทธิ์ GPS และเข็มทิศ', 'GPS and compass permissions')}</h2>
      <p class="body">${t('GeoNote ไม่ขอสิทธิ์อะไรตอนเปิดแอป จะถามเฉพาะตอนแตะปุ่มที่ต้องใช้ GPS หรือเข็มทิศเท่านั้น', 'GeoNote asks for nothing when it opens; it only asks when you tap something that needs the GPS or compass.')}</p>
      ${isIOS() ? `<p class="body">${t('<b>iPhone</b> เป็นคนกำหนดว่าจะถามซ้ำบ่อยแค่ไหน ลดการถามได้โดย', '<b>iPhone</b> decides how often to ask again. To be asked less:')}</p>
      <ol class="steps">
        <li>Settings → Privacy &amp; Security → Location Services → Safari Websites → ${t('เลือก', 'choose')} While Using the App</li>
        <li>Settings → Apps → Safari → Location → ${t('เลือก Allow (iOS 17 ลงไปอยู่ที่ Settings → Safari → Location)', 'choose Allow (on iOS 17 and earlier: Settings → Safari → Location)')}</li>
      </ol>
      <p class="hint">${t('เข็มทิศบน iPhone ต้องแตะอนุญาตใหม่ทุกครั้งที่เปิดแอป เป็นข้อจำกัดของเว็บแอปบน iOS ที่แก้จากฝั่งแอปไม่ได้', 'On iPhone the compass must be allowed again each time the app opens. This is an iOS limit for web apps.')}</p>`
      : `<p class="hint">${t('บน Android เครื่องจะจำสิทธิ์ตำแหน่งไว้ และเข็มทิศไม่ต้องขอสิทธิ์', 'On Android the location permission is remembered and the compass needs no permission.')}</p>`}
    </section>

    <section class="sec">
      <h2 class="sec-h">${t('ข้อมูลออฟไลน์ตามภาค', 'Offline data by region')}</h2>
      <div id="offBox"><p class="hint">${t('กำลังตรวจสอบ', 'Checking')}</p></div>
    </section>

    <section class="sec">
      <h2 class="sec-h">ภาษา · Language</h2>
      <div class="seg lang-seg" role="radiogroup" aria-label="ภาษา Language">${LANGS.map((l) => `<button type="button" role="radio" data-lang="${l.id}" aria-checked="${l.id === getLang()}" class="${l.id === getLang() ? 'on' : ''}">${l.name}</button>`).join('')}</div>
    </section>

    <section class="sec">
      <h2 class="sec-h">${t('ธีมสี', 'Colour theme')}</h2>
      <div class="theme-grid" role="radiogroup" aria-label="${t('ธีมสีของแอป', 'App colour theme')}">
        ${THEMES.map((x) => `<button type="button" class="theme-card" role="radio" data-theme-id="${x.id}" aria-checked="${x.id === s.theme}">
          <span class="theme-prev" style="background:${x.swatch[0]}">
            <i style="background:${x.swatch[1]}"></i><i style="background:${x.swatch[2]}"></i><i style="background:${x.swatch[3]}"></i>
          </span>
          <b>${esc(themeName(x))}${x.id === DEFAULT_THEME ? `<small>${t('ค่าเริ่มต้น', 'default')}</small>` : ''}</b>
          <span class="theme-desc">${esc(themeDesc(x))}</span>
        </button>`).join('')}
      </div>
      <p class="hint">${t(`ปุ่ม ${icon('sun', 'i inline')} มุมขวาบนสลับเป็นธีมกลางแดดชั่วคราว แตะอีกครั้งเพื่อกลับธีมที่เลือกไว้`, `The ${icon('sun', 'i inline')} button at the top right switches to Sunlight for a while; tap it again to go back.`)}</p>
    </section>

    <section class="sec">
      <h2 class="sec-h">Storage</h2>
      <div id="storage"><p class="hint">${t('กำลังตรวจสอบ', 'Checking')}</p></div>
    </section>

    <section class="sec about">
      <h2 class="sec-h">About</h2>
      <p>GeoNote ${store.APP_VERSION}</p><p class="hint">${t('สมุดสนามดิจิทัลสำหรับนักศึกษาเทคโนโลยีธรณี มหาวิทยาลัยขอนแก่น', 'Digital field notebook for Geotechnology students, Khon Kaen University')}</p>
      <p class="hint">${t('ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ไม่มีการส่งขึ้น server ให้ Export เป็น Project ZIP เก็บไว้หลังออกภาคสนามทุกครั้ง', 'All data stays on this phone; nothing is sent to a server. Export a Project ZIP after every field day.')}</p>
    </section>
  </div>`;

  function renderCal() {
    const box = root.querySelector('#calBox');
    if (!box) return;
    const c = store.getSettings().clinoCal;
    box.innerHTML = `
      <p class="kv"><span>${t('ปรับศูนย์ (ไม่บังคับ)', 'Zeroing (optional)')}</span><b>${c ? t(`ปรับแล้ว (หลังเครื่องเอียง ${Number(c.tilt).toFixed(1)}°)`, `Done (phone back tilts ${Number(c.tilt).toFixed(1)}°)`) : t('ยังไม่ได้ปรับ', 'Not done')}</b></p>
      <p class="hint">${t('กล้องหลังที่นูนหรือเคสทำให้มือถือวางบนหินแล้วเอียงเล็กน้อย ค่า Dip จึงคลาดได้ 1–2° ซึ่งมีผลมากกับชั้นหินที่เอียงน้อย ไม่บังคับ แต่แนะนำให้ปรับศูนย์บนโต๊ะครั้งเดียว แล้วทำใหม่เมื่อเปลี่ยนเคส', 'A camera bump or case makes the phone rock slightly on the outcrop, so dip can be off by 1–2°, which matters most on gently dipping beds. Optional, but zero it once on a table and again when you change the case.')}</p>
      <p class="hint">${t('ทิศของ Strike และทิศที่ถ่ายรูปอ้างทิศเหนือตาม Magnetic declination ในหัวข้อ Coordinates', 'Strike and photo bearings use the north set by Magnetic declination under Coordinates.')}</p>
      <div class="btn-row">
        <button type="button" class="btn" id="btnCal">${icon('clino')}${c ? t('ปรับศูนย์ใหม่', 'Zero again') : t('ปรับศูนย์', 'Zero the sensor')}</button>
        ${c ? `<button type="button" class="btn" id="btnCalClear">${t('ล้างค่า', 'Clear')}</button>` : ''}
      </div>`;
    box.querySelector('#btnCal').onclick = () => openCalibration({ onDone: renderCal });
    box.querySelector('#btnCalClear')?.addEventListener('click', async () => {
      if (!confirm(t('ล้างค่าปรับศูนย์? การวัดครั้งต่อไปจะไม่หักค่าเอียงของเครื่อง', 'Clear the zeroing? Later readings will not correct for the phone tilt.'))) return;
      await store.updateSettings({ clinoCal: null });
      toast(t('ล้างค่าปรับศูนย์แล้ว', 'Zeroing cleared'));
      renderCal();
    });
  }
  renderCal();

  async function renderStorage() {
    const info = await store.storageInfo();
    const box = root.querySelector('#storage');
    if (!box) return;
    const used = info.usage != null ? fmtSize(info.usage) : '—';
    const installed = isStandalone();
    box.innerHTML = `
      <p class="kv"><span>${t('พื้นที่ที่ GeoNote ใช้', 'Space used by GeoNote')}</span><b class="mono">${used}</b></p>
      <p class="kv"><span>${t('ป้องกันการลบอัตโนมัติ', 'Protected from automatic clearing')}</span><b>${info.persisted ? t('เปิดแล้ว', 'Yes') : t('ยังไม่เปิด', 'Not yet')}</b></p>
      <p class="kv"><span>${t('ติดตั้งเป็นแอป', 'Installed as an app')}</span><b>${installed ? t('ใช่', 'Yes') : t('ยังไม่ได้ติดตั้ง', 'Not yet')}</b></p>
      ${!info.persisted ? `<button type="button" class="btn sm" id="btnPersist">${t('ขอให้เครื่องเก็บข้อมูลถาวร', 'Ask the phone to keep the data')}</button>` : ''}
      ${!installed && isIOS() ? `<p class="hint">${t('บน iPhone ให้ติดตั้งผ่าน Share แล้วเลือก Add to Home Screen ข้อมูลจะปลอดภัยกว่าใช้ผ่าน Safari', 'On iPhone install it with Share → Add to Home Screen. Data is safer than in Safari alone.')}</p>` : ''}
      <p class="hint">${t('ถ้าลบไอคอน GeoNote ออกจากหน้าจอโฮม ข้อมูลในแอปจะถูกลบด้วย ให้ Export ก่อนทุกครั้ง', 'Removing the GeoNote icon from the Home Screen also deletes its data. Always export first.')}</p>`;
    box.querySelector('#btnPersist')?.addEventListener('click', async () => {
      const ok = await store.ensurePersistence();
      toast(ok ? t('เปิดการเก็บข้อมูลถาวรแล้ว', 'The phone will keep the data') : t('เบราว์เซอร์ยังไม่อนุญาต ลองติดตั้งเป็นแอปก่อน', 'The browser did not allow it yet. Try installing the app first.'), 3500);
      renderStorage();
    });
  }
  renderStorage();

  async function renderOffline() {
    const box = root.querySelector('#offBox');
    if (!box) return;
    const [maps, man] = await Promise.all([offline.stored(), manifest()]);
    const rows = [];
    for (const r of REGIONS) {
      const mapSize = maps.get(r.id)?.size || 0;
      const rocks = await geol.hasRegion(r.id);
      const webMap = man.map[r.id];
      const webRocks = man.geol[r.id];
      const need = (mapSize ? 0 : webMap?.bytes || 0) + (rocks ? 0 : webRocks?.bytes || 0);
      const complete = !!mapSize && rocks;
      const removable = !!mapSize || (rocks && !geol.isBundled(r.id));
      rows.push(`<div class="reg-row">
        <div class="reg-name"><b>${regionName(r)}</b><small>${esc(regionNote(r))}</small></div>
        <div class="reg-state">
          <span class="${mapSize ? 'ok' : ''}">${t('แผนที่', 'Map')} ${mapSize ? fmtSize(mapSize) : webMap ? '—' : t('ยังไม่มีบนเว็บ', 'not on the website yet')}</span>
          <span class="${rocks ? 'ok' : ''}">${t('หน่วยหิน', 'Rock units')} ${rocks ? (geol.isBundled(r.id) ? t('ติดมากับแอป', 'built in') : t('มีแล้ว', 'saved')) : webRocks ? '—' : t('ยังไม่มีบนเว็บ', 'not on the website yet')}</span>
        </div>
        <div class="reg-btns">
          ${!complete && (webMap || webRocks) ? `<button type="button" class="btn sm" data-dl="${r.id}">${icon('download')}${need ? fmtSize(need) : t('โหลด', 'Get')}</button>` : ''}
          ${removable ? `<button type="button" class="btn sm" data-rm="${r.id}" aria-label="${t(`ลบข้อมูล${regionName(r)}`, `Delete ${regionName(r)} data`)}">${icon('trash')}</button>` : ''}
        </div>
      </div>`);
    }
    const dlNow = offline.busy();
    box.innerHTML = `${rows.join('')}
      ${dlNow ? `<p class="hint">${t('กำลังดาวน์โหลดแผนที่อยู่ หน้านี้จะอัปเดตเมื่อเสร็จ', 'A map is downloading; this list updates when it finishes')}</p>` : ''}
      <p class="hint">${t('แตะปุ่มดาวน์โหลดตอนต่อ Wi-Fi ก่อนออกภาคสนาม ได้ทั้งแผนที่ถนนและหน่วยหินของภาคนั้น ใช้ได้โดยไม่ต้องต่อเน็ต เมื่อไม่มีเน็ต แผนที่ในหน้า GPS และ Map เปลี่ยนเป็นแผนที่ออฟไลน์ให้เอง ขอบเขตภาคเป็นเส้นตรงโดยประมาณ ถ้าพื้นที่สำรวจอยู่ใกล้รอยต่อให้โหลดทั้งสองภาค', 'Download on Wi-Fi before fieldwork: you get the street map and rock units of that region, usable with no internet. With no internet the GPS and Map screens switch to the offline map by themselves. Region borders are approximate straight lines; near a border, download both regions.')}</p>
      <p class="hint">${t('แผนที่ © OpenStreetMap contributors · หน่วยหิน 1:250,000 © กรมทรัพยากรธรณี', 'Map © OpenStreetMap contributors · Rock units 1:250,000 © Department of Mineral Resources')}</p>`;
  }
  root.querySelector('#offBox')?.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-dl]');
    const rm = e.target.closest('[data-rm]');
    if (dl) {
      dl.disabled = true;
      await downloadRegion(dl.dataset.dl);
      renderOffline(); renderStorage();
    } else if (rm) {
      const r = regionById(rm.dataset.rm);
      if (!confirm(t(`ลบข้อมูลออฟไลน์${regionName(r)}ออกจากเครื่อง?${geol.isBundled(r.id) ? ` (หน่วยหิน${regionName(r)}ยังอยู่ เพราะติดมากับแอป)` : ''}`, `Delete the ${regionName(r)} offline data from this phone?${geol.isBundled(r.id) ? ` (The ${regionName(r)} rock units stay, as they come with the app.)` : ''}`))) return;
      await offline.remove(r.id);
      await geol.removeRegion(r.id);
      if (r.id === offline.BUNDLED) store.updateSettings({ offlineIsanSkip: true });
      toast(t(`ลบข้อมูล${regionName(r)}แล้ว`, `${regionName(r)} data deleted`));
      renderOffline(); renderStorage();
    }
  });
  const offUnsub = offline.subscribe(({ downloading }) => { if (!downloading) renderOffline(); });
  renderOffline();

  async function checkPrefix() {
    const warn = root.querySelector('#prefixWarn');
    const owner = await store.samplePrefixOwner(store.getProject().samplePrefix, store.getProject().id);
    if (!warn) return;
    warn.classList.toggle('hidden', !owner);
    if (owner) warn.textContent = t(`Sample prefix นี้ใช้อยู่แล้วในโปรเจกต์ "${owner}" รหัสตัวอย่างหินจะซ้ำกันได้`, `This sample prefix is already used in project "${owner}". Sample codes could repeat.`);
  }
  checkPrefix();

  async function saveField(key, value) {
    if (key === 'projectName') {
      if (!value.trim()) return;
      await store.updateProject({ name: value });
      mainHeader();
    } else if (key === 'stationPrefix' || key === 'samplePrefix') {
      const clean = value.trim().replace(/\s+/g, '');
      if (!clean) return;
      await store.updateProject({ [key]: clean });
      const ex = root.querySelector('#idExample');
      if (ex) ex.innerHTML = example();
      checkPrefix();
    } else if (key === 'declination') {
      const v = parseNum(value);
      if (v === null || Number.isNaN(v) || v < -30 || v > 30) return;
      await store.updateSettings({ declination: v });
    } else {
      await store.updateSettings({ [key]: value });
    }
  }
  // One debounced saver per field, so typing in one field never drops a pending edit in another.
  const savers = new Map();
  const saveText = (key, value) => {
    if (!savers.has(key)) savers.set(key, debounce((v) => saveField(key, v), 400));
    savers.get(key)(value);
  };

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.k) return;
    if (t.dataset.k === 'declination') {
      const v = parseNum(t.value);
      t.classList.toggle('invalid', v !== null && (Number.isNaN(v) || v < -30 || v > 30));
    }
    saveText(t.dataset.k, t.value);
  });

  root.addEventListener('click', async (e) => {
    const lb = e.target.closest('[data-lang]');
    if (lb) {
      if (lb.dataset.lang === getLang()) return;
      setLang(lb.dataset.lang);
      await store.updateSettings({ lang: lb.dataset.lang });
      document.dispatchEvent(new CustomEvent('geonote:lang'));
      return;
    }
    const card = e.target.closest('.theme-card');
    if (card) {
      const id = card.dataset.themeId;
      root.querySelectorAll('.theme-card').forEach((c) => c.setAttribute('aria-checked', String(c === card)));
      applyTheme(id);
      await store.updateSettings({ theme: id });
      mainHeader();
      return;
    }
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.closest('.seg');
    const key = group.dataset.k;
    group.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    const value = key === 'gpsTarget' ? Number(b.dataset.v) : key === 'smartAutoSave' ? b.dataset.v === 'on' : b.dataset.v;
    await store.updateSettings({ [key]: value });
    
  });

  return () => { offUnsub(); savers.forEach((d) => d.flush()); };
}
