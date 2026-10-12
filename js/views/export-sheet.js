// Export sheet: choose which projects, then which kind of file.

import * as store from '../store.js';
import * as exporter from '../export.js';
import { icon } from '../icons.js';
import { toast, openOverlay } from '../ui.js';
import { esc, fmtSize } from '../util.js';
import { t } from '../i18n.js';

const FORMATS = () => [
  ['zip', 'Project ZIP', t('ทุกอย่างในไฟล์เดียว: Excel, CSV, GeoJSON, KML, GPX, รูปภาพ และไฟล์สำรอง', 'Everything in one file: Excel, CSV, GeoJSON, KML, GPX, photos and a backup'), true],
  ['xlsx', 'Excel (.xlsx)', t('ตาราง Stations, Structures และ Samples แยกแผ่นงาน', 'Stations, Structures and Samples on separate sheets')],
  ['csv', 'CSV', t('ตาราง Stations สำหรับ Google Sheets หรือโปรแกรมอื่น', 'Stations table for Google Sheets and other programs')],
  ['geojson', 'GeoJSON Stations', t('จุด Station สำหรับ QGIS และ ArcGIS', 'Station points for QGIS and ArcGIS')],
  ['struct', 'GeoJSON Structures', t('หนึ่งจุดต่อหนึ่งการวัด สำหรับทำสัญลักษณ์ strike/dip', 'One point per measurement, for strike/dip symbols')],
  ['kml', 'KML', t('เปิดใน Google Earth พร้อมเส้นทางตามลำดับเวลา', 'Opens in Google Earth with the route in time order')],
  ['gpx', 'GPX', t('จุดและเส้นทางสำหรับแอป GPS และแอปนำทาง', 'Points and route for GPS and navigation apps')],
  ['smart', 'Smart Photos', t('ทุกรูปพร้อมแถบข้อมูล Station พิกัด ทิศที่ถ่าย และ Strike/Dip (ZIP)', 'Every photo with its station, coordinates, bearing and strike/dip strip (ZIP)')],
];

export async function openExportSheet() {
  const projects = await store.listProjects();
  const current = store.getProject().id;
  const multi = projects.length > 1;

  const { el, close } = openOverlay(`<div class="sheet" role="dialog" aria-label="Export">
      <div class="sheet-grip"></div>
      <h3>Export</h3>
      <p class="sheet-sub">${t('เลือกโปรเจกต์ แล้วเลือกรูปแบบไฟล์', 'Choose the projects, then the file type')}</p>
      <div class="x-h"><span>${t('โปรเจกต์', 'Projects')}</span>${multi ? `<button type="button" class="link-btn" data-all>${t('เลือกทั้งหมด', 'Select all')}</button>` : ''}</div>
      <div class="x-projects">
        ${projects.map((p) => `<label class="x-proj">
          <input type="checkbox" value="${p.id}"${p.id === current ? ' checked' : ''}>
          <span class="x-check" aria-hidden="true">${icon('check')}</span>
          <span class="x-pname"><b>${esc(p.name)}</b><small>${p.stats.stations} Stations, ${p.stats.photos} Photos</small></span>
        </label>`).join('')}
      </div>
      <div class="x-h"><span>${t('รูปแบบไฟล์', 'File type')}</span></div>
      <div class="x-list">
        ${FORMATS().map(([k, name, desc, main]) => `<button type="button" class="x-item${main ? ' main' : ''}" data-x="${k}"><b>${name}</b><span>${desc}</span></button>`).join('')}
      </div>
      <div class="x-ready hidden" id="xReady"></div>
      <button type="button" class="btn block" data-close>${t('ปิด', 'Close')}</button>
    </div>`, {
    onClick: async (e) => {
      if (e.target.closest('[data-all]')) {
        const boxes = [...el.querySelectorAll('.x-proj input')];
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !all; });
        e.target.closest('[data-all]').textContent = all ? t('เลือกทั้งหมด', 'Select all') : t('ยกเลิกทั้งหมด', 'Clear all');
        return;
      }
      const item = e.target.closest('[data-x]');
      if (!item) return;
      const ids = [...el.querySelectorAll('.x-proj input:checked')].map((b) => b.value);
      if (!ids.length) return toast(t('เลือกอย่างน้อยหนึ่งโปรเจกต์', 'Choose at least one project'));
      const ready = el.querySelector('#xReady');
      el.querySelectorAll('[data-x]').forEach((b) => { b.disabled = true; });
      ready.classList.remove('hidden');
      ready.innerHTML = `<p class="x-busy"><i class="spinner"></i><span>${t('กำลังเตรียมไฟล์', 'Preparing the file')}</span></p>`;
      ready.scrollIntoView({ block: 'nearest' });
      try {
        const kind = item.dataset.x;
        const file = await exporter.build(kind, ids, (done, total) => {
          const s = ready.querySelector('.x-busy span');
          if (s) s.textContent = `${kind === 'smart' ? t('กำลังสร้าง Smart Photo', 'Making Smart Photos') : t('กำลังรวมรูป', 'Adding photos')} ${done}/${total}`;
        });
        // A fresh tap is needed to open the share sheet, so offer a button once the file is ready.
        ready.innerHTML = `<div class="x-file">
            ${icon('file')}
            <div><b>${esc(file.name)}</b><span>${fmtSize(file.size)}</span></div>
          </div>
          <button type="button" class="btn-primary block" id="xGo">${icon('share')}<span>${t('บันทึกหรือแชร์ไฟล์', 'Save or share the file')}</span></button>`;
        ready.scrollIntoView({ block: 'nearest' });
        ready.querySelector('#xGo').onclick = async () => {
          const res = await exporter.deliver(file);
          if (res === 'downloaded') toast(t('ดาวน์โหลดไฟล์แล้ว', 'File downloaded'));
          else if (res === 'shared') toast(t('ส่งไฟล์แล้ว', 'File shared'));
          if (res !== 'cancelled') close();
        };
      } catch (err) {
        ready.innerHTML = `<p class="x-error">${t('สร้างไฟล์ไม่สำเร็จ', 'Could not make the file')}: ${esc(err.message)}</p>`;
      } finally {
        el.querySelectorAll('[data-x]').forEach((b) => { b.disabled = false; });
      }
    },
  });
}
