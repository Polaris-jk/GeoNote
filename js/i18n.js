// Interface language: Thai ('th') or English ('en').
//
// Every piece of text is written with both languages side by side where it is used:
//   t('บันทึก', 'Save')
//   t(`แผนที่${name}`, `${name} map`)
// so a screen reads naturally in either language and nothing has to be looked up by key.
// Changing the language redraws the current screen (see app.js).

export const LANGS = [
  { id: 'th', name: 'ไทย' },
  { id: 'en', name: 'English' },
];
export const LANG_KEY = 'geonote.lang'; // mirrored for index.html (loading screen)

function initial() {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'th' || v === 'en') return v; } catch { /* private mode */ }
  return /^th\b/i.test(navigator.language || 'th') ? 'th' : 'en';
}

let lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const isEn = () => lang === 'en';

/** Pick the text for the current language. */
export function t(th, en) {
  return lang === 'en' && en != null ? en : th;
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'th';
  document.documentElement.lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
}
