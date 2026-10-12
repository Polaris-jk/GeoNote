// Projects — one project per field day or traverse line. Each keeps its own stations,
// samples and photos, and its own sample prefix so sample IDs never clash in the lab.

import * as store from '../store.js';
import { icon } from '../icons.js';
import { setHeader, toast, openOverlay } from '../ui.js';
import { esc, fmtDay } from '../util.js';
import { t } from '../i18n.js';

function projectForm(title, p, submitLabel) {
  return `<div class="sheet" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-grip"></div>
    <h3>${esc(title)}</h3>
    <label class="field"><span class="lbl">${t('ชื่อโปรเจกต์', 'Project name')}</span>
      <input type="text" id="pjName" value="${esc(p.name)}" autocomplete="off" placeholder="${t('เช่น ไลน์ 2 ภูเวียง', 'e.g. Traverse 2 Phu Wiang')}"></label>
    <div class="field-2">
      <label class="field"><span class="lbl">Sample prefix</span>
        <input type="text" class="mono" id="pjSample" value="${esc(p.samplePrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
      <label class="field"><span class="lbl">Station prefix</span>
        <input type="text" class="mono" id="pjStation" value="${esc(p.stationPrefix)}" maxlength="12" autocomplete="off" autocapitalize="characters"></label>
    </div>
    <p class="hint" id="pjHint"></p>
    <p class="warn-text hidden" id="pjWarn"></p>
    <div class="btn-row">
      <button type="button" class="btn" data-close>${t('ยกเลิก', 'Cancel')}</button>
      <button type="button" class="btn-primary" id="pjSave">${esc(submitLabel)}</button>
    </div>
  </div>`;
}

/** Wire the form: live example IDs and a warning when the sample prefix is already used. */
function bindForm(el, exceptId) {
  const name = el.querySelector('#pjName');
  const sample = el.querySelector('#pjSample');
  const station = el.querySelector('#pjStation');
  const hint = el.querySelector('#pjHint');
  const warn = el.querySelector('#pjWarn');
  const clean = (v) => v.trim().replace(/\s+/g, '');
  async function update() {
    const sp = clean(sample.value) || 'GEO';
    const tp = clean(station.value) || 'ST';
    hint.textContent = t(`รหัสจะเป็นแบบ Station ${tp}-001 และตัวอย่างหิน ${sp}-001-01`, `Codes will look like station ${tp}-001 and sample ${sp}-001-01`);
    const owner = await store.samplePrefixOwner(sp, exceptId);
    warn.classList.toggle('hidden', !owner);
    if (owner) warn.textContent = t(`Sample prefix ${sp} ใช้อยู่แล้วในโปรเจกต์ "${owner}" รหัสตัวอย่างหินจะซ้ำกันได้`, `Sample prefix ${sp} is already used in project "${owner}". Sample codes could repeat.`);
  }
  [sample, station].forEach((i) => i.addEventListener('input', update));
  update();
  setTimeout(() => { name.focus(); name.select(); }, 60);
  return () => ({ name: name.value, samplePrefix: clean(sample.value), stationPrefix: clean(station.value) });
}

export async function openNewProject(onDone) {
  const n = (await store.listProjects()).length;
  const draft = { name: `Line ${n + 1}`, samplePrefix: await store.suggestSamplePrefix(), stationPrefix: 'ST' };
  const { el, close } = openOverlay(projectForm(t('โปรเจกต์ใหม่', 'New project'), draft, t('สร้างและเริ่มใช้', 'Create and start')));
  const read = bindForm(el);
  el.querySelector('#pjSave').onclick = async () => {
    const v = read();
    if (!v.name.trim()) return toast(t('ตั้งชื่อโปรเจกต์ก่อน', 'Name the project first'));
    const p = await store.createProject(v);
    close();
    toast(t(`เริ่มโปรเจกต์ใหม่: ${p.name}`, `New project started: ${p.name}`));
    onDone?.(p);
  };
}

function itemHTML(p, currentId) {
  const cur = p.id === currentId;
  return `<li class="pj${cur ? ' current' : ''}" data-id="${p.id}">
    <button type="button" class="pj-open" data-act="open">
      <span class="pj-name">${esc(p.name)}${cur ? `<em class="badge-cur">${t('กำลังใช้', 'In use')}</em>` : ''}</span>
      <span class="pj-stats">
        <span><b>${p.stats.stations}</b> Stations</span>
        <span><b>${p.stats.samples}</b> Samples</span>
        <span><b>${p.stats.photos}</b> Photos</span>
      </span>
      <span class="pj-meta">${t(`สร้างเมื่อ ${fmtDay(p.createdAt)}, ตัวอย่างหินขึ้นต้นด้วย ${esc(p.samplePrefix)}`, `Created ${fmtDay(p.createdAt)}, samples start with ${esc(p.samplePrefix)}`)}</span>
    </button>
    <button type="button" class="icon-btn" data-act="more" aria-label="${t('ตัวเลือกของ', 'Options for')} ${esc(p.name)}">${icon('more')}</button>
  </li>`;
}

export async function render(root, ctx) {
  const back = ctx.prev && !ctx.prev.startsWith('#/projects') ? ctx.prev : '#/stations';
  setHeader({
    left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="${t('กลับ', 'Back')}">${icon('back')}</button>`,
    title: '<span class="hdr-title">Projects</span>',
  });
  document.getElementById('hdrBack').onclick = () => { location.hash = back; };

  async function paint() {
    const list = await store.listProjects();
    if (!ctx.alive()) return;
    const currentId = store.getProject().id;
    root.innerHTML = `<div class="screen projects-screen">
      <p class="lead">${t('แยกข้อมูลเป็น<span class="nw">โปรเจกต์</span> เช่น หนึ่งวันหรือหนึ่งไลน์เดินต่อหนึ่ง<span class="nw">โปรเจกต์</span> แตะเพื่อเปิดใช้งาน', 'Keep your data in projects, for example one per day or per traverse. Tap a project to use it.')}</p>
      <ul class="pj-list">${list.map((p) => itemHTML(p, currentId)).join('')}</ul>
    </div>
    <div class="cta"><button type="button" class="btn-primary xl" data-act="new">${icon('plus')}<span>NEW PROJECT</span></button></div>`;
  }
  await paint();
  if (!ctx.alive()) return;

  async function openProject(id) {
    await store.switchProject(id);
    toast(t(`เปิดโปรเจกต์ ${store.getProject().name}`, `Now using ${store.getProject().name}`));
    location.hash = '#/stations';
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.closest('[data-id]')?.dataset.id;

    if (act === 'new') {
      openNewProject(() => { location.hash = '#/gps'; });
    } else if (act === 'open') {
      openProject(id);
    } else if (act === 'more') {
      const list = await store.listProjects();
      const p = list.find((x) => x.id === id);
      if (!p) return;
      const { el, close } = openOverlay(`<div class="sheet" role="dialog" aria-label="${esc(p.name)}">
        <div class="sheet-grip"></div>
        <h3>${esc(p.name)}</h3>
        <p class="sheet-sub">${p.stats.stations} Stations, ${p.stats.samples} Samples, ${p.stats.photos} Photos</p>
        <div class="x-list">
          <button type="button" class="x-item" data-a="open"><b>${icon('folder')}${t('เปิดโปรเจกต์นี้', 'Use this project')}</b></button>
          <button type="button" class="x-item" data-a="edit"><b>${icon('edit')}${t('แก้ชื่อและรหัส', 'Edit name and codes')}</b></button>
          <button type="button" class="x-item danger" data-a="delete"><b>${icon('trash')}${t('ลบโปรเจกต์', 'Delete project')}</b><span>${t('ลบ Station ตัวอย่างหิน และรูปทั้งหมดของโปรเจกต์นี้', 'Deletes every station, sample and photo in this project')}</span></button>
        </div>
        <button type="button" class="btn block" data-close>${t('ปิด', 'Close')}</button>
      </div>`);
      el.querySelector('[data-a=open]').onclick = () => { close(); openProject(id); };
      el.querySelector('[data-a=edit]').onclick = () => {
        close();
        const f = openOverlay(projectForm(t('แก้ชื่อและรหัส', 'Edit name and codes'), p, t('บันทึก', 'Save')));
        const read = bindForm(f.el, p.id);
        f.el.querySelector('#pjSave').onclick = async () => {
          const v = read();
          await store.updateProject(v, p.id);
          f.close();
          toast(t('บันทึกแล้ว', 'Saved'));
          paint();
        };
      };
      el.querySelector('[data-a=delete]').onclick = async () => {
        const msg = t(`ลบโปรเจกต์ "${p.name}"?\n\nStation ${p.stats.stations} จุด ตัวอย่างหิน ${p.stats.samples} ชิ้น และรูป ${p.stats.photos} รูปจะถูกลบถาวร ย้อนกลับไม่ได้\nถ้ายังไม่ได้ Export ให้กดยกเลิกก่อน`, `Delete project "${p.name}"?\n\n${p.stats.stations} stations, ${p.stats.samples} samples and ${p.stats.photos} photos will be deleted for good. This cannot be undone.\nIf you have not exported yet, tap Cancel first.`);
        if (!confirm(msg)) return;
        close();
        await store.deleteProject(p.id);
        toast(t(`ลบโปรเจกต์ ${p.name} แล้ว`, `Project ${p.name} deleted`));
        paint();
      };
    }
  });
}
