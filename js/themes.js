import { t } from './i18n.js';
// Colour themes. The colours themselves live in css/app.css ([data-theme='…']); this list gives
// the names shown in Settings, the four preview colours of each card, and the status-bar colour.

export const THEMES = [
  { id: 'geonote', name: 'GeoNote', nameEn: 'GeoNote', desc: 'ขาวมินิมอล โทนเอิร์ธ ตามไอคอนแอป', descEn: 'Minimal white and earth tones, from the app icon', mode: 'light', bar: '#f8f7f3', swatch: ['#f8f7f3', '#2e4a62', '#c9a27e', '#7fa6c0'] },
  { id: 'sandstone', name: 'หินทราย', nameEn: 'Sandstone', desc: 'ครีมอุ่น สีดินเผา', descEn: 'Warm cream and terracotta', mode: 'light', bar: '#f6efe4', swatch: ['#f6efe4', '#b0532c', '#d9b98f', '#3a2a1e'] },
  { id: 'moss', name: 'ป่าเขา', nameEn: 'Moss', desc: 'เขียวตะไคร่ สบายตา', descEn: 'Calm moss green', mode: 'light', bar: '#f3f4ee', swatch: ['#f3f4ee', '#4e6b3a', '#a7b48c', '#1f2a1f'] },
  { id: 'basalt', name: 'บะซอลต์', nameEn: 'Basalt', desc: 'เทาเข้ม สีทราย สำหรับตอนเย็น', descEn: 'Dark slate and sand, for the evening', mode: 'dark', bar: '#1b2229', swatch: ['#1b2229', '#d6b48a', '#5b6b78', '#ece6da'] },
  { id: 'dark', name: 'กลางคืน', nameEn: 'Night', desc: 'ดำสนิท ประหยัดแบตจอ OLED', descEn: 'True black, saves battery on OLED screens', mode: 'dark', bar: '#000000', swatch: ['#000000', '#f5c933', '#2a2e2f', '#ecebe3'] },
  { id: 'sun', name: 'กลางแดด', nameEn: 'Sunlight', desc: 'ขาว-ดำ ตัดกันชัด อ่านง่ายกลางแดด', descEn: 'High-contrast black on white for glare', mode: 'light', bar: '#ffffff', swatch: ['#ffffff', '#000000', '#f5c933', '#cfcfc6'] },
];
export const DEFAULT_THEME = 'geonote';
export const themeById = (id) => THEMES.find((x) => x.id === id) || THEMES[0];
export const themeName = (x) => t(x.name, x.nameEn);
export const themeDesc = (x) => t(x.desc, x.descEn);

// mirrored in localStorage so index.html can colour the loading screen before the app starts
export const THEME_KEY = 'geonote.theme';
