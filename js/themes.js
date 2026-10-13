import { t } from './i18n.js';
// Colour themes. The colours themselves live in css/app.css ([data-theme='…']); this list gives
// the names shown in Settings, which group a theme is listed under, light or dark, and the
// status-bar colour. The cards in Settings draw a small preview of the app in each theme.
//
// Special themes take their colours from published palettes where named:
//   รุ่งอรุณ  Rosé Pine Dawn  — rosepinetheme.com
//   แสงเหนือ  Nord           — nordtheme.com
//   มอคค่า    Catppuccin Mocha — catppuccin.com

export const THEMES = [
  { id: 'geonote', group: 'base', name: 'GeoNote', nameEn: 'GeoNote', desc: 'ขาวมินิมอล โทนเอิร์ธ ตามไอคอนแอป', descEn: 'Minimal white and earth tones, from the app icon', mode: 'light', bar: '#f8f7f3' },
  { id: 'sandstone', group: 'base', name: 'หินทราย', nameEn: 'Sandstone', desc: 'ครีมอุ่น สีดินเผา', descEn: 'Warm cream and terracotta', mode: 'light', bar: '#f6efe4' },
  { id: 'moss', group: 'base', name: 'ป่าเขา', nameEn: 'Moss', desc: 'เขียวตะไคร่ สบายตา', descEn: 'Calm moss green', mode: 'light', bar: '#f3f4ee' },
  { id: 'basalt', group: 'base', name: 'บะซอลต์', nameEn: 'Basalt', desc: 'เทาเข้ม สีทราย สำหรับตอนเย็น', descEn: 'Dark slate and sand, for the evening', mode: 'dark', bar: '#1b2229' },
  { id: 'dark', group: 'base', name: 'กลางคืน', nameEn: 'Night', desc: 'ดำสนิท ประหยัดแบตจอ OLED', descEn: 'True black, saves battery on OLED screens', mode: 'dark', bar: '#000000' },
  { id: 'sun', group: 'base', name: 'กลางแดด', nameEn: 'Sunlight', desc: 'ขาว-ดำ ตัดกันชัด อ่านง่ายกลางแดด', descEn: 'High-contrast black on white for glare', mode: 'light', bar: '#ffffff' },

  { id: 'fieldbook', group: 'special', name: 'สมุดสนาม', nameEn: 'Field book', desc: 'กระดาษเหลืองกันน้ำ ตาราง 5 มม.', descEn: 'Yellow all-weather paper, 5 mm grid', mode: 'light', bar: '#f2e8b6' },
  { id: 'topo', group: 'special', name: 'แผนที่ภูมิประเทศ', nameEn: 'Topo sheet', desc: 'ลายเส้นชั้นความสูงสีน้ำตาล', descEn: 'Brown contour lines', mode: 'light', bar: '#f8f4ea' },
  { id: 'blueprint', group: 'special', name: 'พิมพ์เขียว', nameEn: 'Blueprint', desc: 'พื้นน้ำเงิน เส้นกริดเขียนแบบ', descEn: 'Blue sheet, drafting grid', mode: 'dark', bar: '#14365c' },
  { id: 'dawn', group: 'special', name: 'รุ่งอรุณ', nameEn: 'Dawn', desc: 'Rosé Pine Dawn แถบชั้นหินใต้หัวแอป', descEn: 'Rosé Pine Dawn, rock layers under the header', mode: 'light', bar: '#f2e9e1' },
  { id: 'aurora', group: 'special', name: 'แสงเหนือ', nameEn: 'Aurora', desc: 'Nord ปุ่มและเส้นไล่สีแสงเหนือ', descEn: 'Nord, aurora gradients', mode: 'dark', bar: '#2e3440' },
  { id: 'mocha', group: 'special', name: 'มอคค่า', nameEn: 'Mocha', desc: 'Catppuccin พาสเทลบนพื้นเข้ม', descEn: 'Catppuccin pastels on dark', mode: 'dark', bar: '#181825' },
  { id: 'redlight', group: 'special', name: 'แสงแดงกลางคืน', nameEn: 'Red night', desc: 'แดงทั้งจอและแผนที่ ถนอมสายตาตอนมืด', descEn: 'All red, map too, keeps night vision', mode: 'dark', bar: '#000000' },
];
export const THEME_GROUPS = [
  { id: 'base', name: 'ธีมหลัก', nameEn: 'Main themes' },
  { id: 'special', name: 'ลวดลายและชุดสีพิเศษ', nameEn: 'Patterns and special palettes' },
];
export const DEFAULT_THEME = 'geonote';
export const themeById = (id) => THEMES.find((x) => x.id === id) || THEMES[0];
export const themeName = (x) => t(x.name, x.nameEn);
export const themeDesc = (x) => t(x.desc, x.descEn);

// mirrored in localStorage so index.html can colour the loading screen before the app starts
export const THEME_KEY = 'geonote.theme';
