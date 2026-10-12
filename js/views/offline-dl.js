// Download a region's offline data (street map and/or rock units) with progress in toasts.

import * as offline from '../offlinemap.js';
import * as geol from '../geology.js';
import { regionById, regionName } from '../regions.js';
import { toast } from '../ui.js';
import { fmtSize } from '../util.js';
import { t } from '../i18n.js';

/** Resolves true when everything asked for is on the phone. */
export async function downloadRegion(id, { map = true, rocks = true } = {}) {
  const name = regionName(regionById(id)) || id;
  if (!navigator.onLine) { toast(t('ต้องต่อเน็ตเพื่อดาวน์โหลด', 'Connect to the internet to download'), 3500); return false; }
  let ok = true;
  if (rocks && !geol.isBundled(id) && !(await geol.hasRegion(id))) {
    try {
      toast(t(`กำลังโหลดหน่วยหิน${name}…`, `Downloading ${name} rock units…`), 2000);
      const r = await geol.downloadRegion(id);
      toast(t(`หน่วยหิน${name} ${r.total} หน่วย พร้อมใช้ออฟไลน์`, `${name}: ${r.total} rock units ready offline`), 2500);
    } catch (err) {
      ok = false;
      toast(t(`โหลดหน่วยหิน${name}ไม่สำเร็จ: ${err.message}`, `Could not download ${name} rock units: ${err.message}`), 5000);
    }
  }
  if (map && !(await offline.sizeOf(id))) {
    let last = 0;
    try {
      toast(t(`กำลังดาวน์โหลดแผนที่ออฟไลน์${name}…`, `Downloading the ${name} offline map…`), 2000);
      await offline.download(id, (got, total) => {
        const now = Date.now();
        if (now - last < 1200) return;
        last = now;
        toast(total ? `${t(`แผนที่${name}`, `${name} map`)} ${Math.round((got / total) * 100)}% (${fmtSize(got)} / ${fmtSize(total)})` : `${t(`แผนที่${name}`, `${name} map`)} ${fmtSize(got)}`, 1500);
      });
      toast(t(`แผนที่ออฟไลน์${name}พร้อมใช้แล้ว`, `${name} offline map is ready`), 3500);
    } catch (err) {
      ok = false;
      toast(t(`ดาวน์โหลดแผนที่${name}ไม่สำเร็จ: ${err.message}`, `Could not download the ${name} map: ${err.message}`), 5000);
    }
  }
  return ok;
}
