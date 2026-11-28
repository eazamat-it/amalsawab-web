// amalsawab.com — главная страница.
// Время намаза сайт НЕ считает сам: готовые расписания городов (data/pt/*.json)
// заранее считает закрытый сборщик тем же кодом, что и приложение. Код расчёта
// на сайте не публикуется. Для места пользователя берётся ближайший город.
// Местоположение никуда не отправляется: ближайший город ищется в браузере,
// всё хранится только в браузере (localStorage).
const formatTime = (date, tz) => {
  if (!date) return '—';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date); }
  catch (_) { return '—'; }
};

const LANGS = ['ru','kk','en','uz','ky','ar','id','ur','bn','tr'];
const LANG_NAMES = { ru:'Русский', kk:'Қазақша', en:'English', uz:'O‘zbek', ky:'Кыргызча', ar:'العربية', id:'Indonesia', ur:'اردو', bn:'বাংলা', tr:'Türkçe' };
const RTL = new Set(['ar','ur']);
// Страницы «Время намаза по городам» (есть на 5 языках; для остальных — английские)
const CITY_PATHS = { ru: '/ru/vremya-namaza/', kk: '/kk/namaz-uakyty/', en: '/en/prayer-times/', ar: '/ar/mawaqit-al-salah/', id: '/id/jadwal-sholat/' };
const KEYS = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
const NEXT_KEYS = ['fajr','dhuhr','asr','maghrib','isha']; // как в приложении: восход не «следующий намаз»
const KAABA = [21.422487, 39.826206];

const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem('as_' + k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('as_' + k, v); } catch (_) {} },
};

let I = {};          // тексты
let lang = 'ru';
let place = null;    // { lat, lon, name, cc }
let times = null;    // { today, tomorrow, tz }
let tick = null;

// ── Язык ─────────────────────────────────────────────────────────────────────
function pickLang() {
  const u = new URLSearchParams(location.search).get('lang');
  if (u && LANGS.includes(u)) return u;
  const s = store.get('lang');
  if (s && LANGS.includes(s)) return s;
  for (const n of navigator.languages || [navigator.language || '']) {
    const c = String(n).slice(0, 2).toLowerCase();
    if (LANGS.includes(c)) return c;
  }
  return 'ru';
}
const t = (k) => I[lang]?.[k] ?? I.en?.[k] ?? k;

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = t(el.dataset.tp); });
  $('meta[name=description]')?.setAttribute('content', t('meta_desc'));
  const cl = $('#cities-link'); if (cl) cl.href = CITY_PATHS[lang] || CITY_PATHS.en;
  $('#lang-btn').textContent = LANG_NAMES[lang];
  document.querySelectorAll('#lang-menu button').forEach((b) => b.setAttribute('aria-current', b.dataset.l === lang ? 'true' : 'false'));
}

// ── Места (GeoNames) ─────────────────────────────────────────────────────────
const tileCache = new Map();
async function loadTile(la, lo) {
  const k = Math.floor(la / 10) + '_' + Math.floor(lo / 10);
  if (!tileCache.has(k)) {
    tileCache.set(k, fetch('data/places/t' + k + '.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return tileCache.get(k);
}
const B36 = (c) => parseInt(c, 36);
function distKm(a1, o1, a2, o2) {
  const R = 6371, d = Math.PI / 180;
  const x = Math.sin((a2 - a1) * d / 2) ** 2 + Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin((o2 - o1) * d / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function entryName(e) {
  const parts = e.split('|');
  const base = parts[0].slice(7);
  const by = {};
  for (let i = 1; i < parts.length; i++) by[LANGS[Number(parts[i][0])]] = parts[i].slice(1);
  return { base, by };
}
function nameIn(n) {
  if (n.by[lang]) return n.by[lang];
  if ((lang === 'kk' || lang === 'ky') && n.by.ru) return n.by.ru;
  return n.base;
}
// Ближайший пункт (та же логика, что в приложении без интернета)
async function nearestPlace(la, lo) {
  let best = null, bestScore = Infinity, bestD = 0, bestR = 0;
  const cla = Math.floor(la), clo = Math.floor(lo);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = cla + i; let o = clo + j;
    if (o < -180) o += 360; else if (o > 179) o -= 360;
    const tile = await loadTile(a, o);
    const s = tile[a + '_' + o];
    if (!s) continue;
    for (const e of s.split(';')) {
      const ea = a + (B36(e[0]) * 36 + B36(e[1])) / 1000;
      const eo = o + (B36(e[2]) * 36 + B36(e[3])) / 1000;
      const r = B36(e[4]) / 2;
      const d = distKm(la, lo, ea, eo);
      if (d - r < bestScore) { bestScore = d - r; best = e; bestD = d; bestR = r; }
    }
  }
  if (!best || bestD > 60) return null;
  return { n: entryName(best), cc: best.slice(5, 7), d: bestD, r: bestR };
}
function placeLabel(np) {
  if (!np) return '';
  const nm = nameIn(np.n);
  return np.d <= np.r ? nm : `${nm} · ≈${Math.max(1, Math.round(np.d))} ${t('km')}`;
}

let searchData = null, searchLang = null;
async function loadSearch() {
  if (searchData && searchLang === lang) return searchData;
  searchLang = lang;
  searchData = await fetch('data/places/search-' + lang + '.json').then((r) => r.json()).catch(() => []);
  return searchData;
}
const norm = (s) => String(s).toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻʼ‘’'`ʹ-]/g, '');
async function search(q) {
  const data = await loadSearch();
  const nq = norm(q.trim());
  if (nq.length < 2) return [];
  const starts = [], inside = [];
  for (const row of data) {
    const a = norm(row[3]), b = row[4] ? norm(row[4]) : '';
    if (a.startsWith(nq) || b.startsWith(nq)) starts.push(row);
    else if (nq.length >= 3 && (a.includes(nq) || b.includes(nq))) inside.push(row);
    if (starts.length >= 12) break;
  }
  return starts.concat(inside).slice(0, 12);
}

// ── Время намаза ─────────────────────────────────────────────────────────────
// Готовые расписания городов (data/pt). Ближайший город к месту пользователя.
let citiesP = null;
const loadCities = () => (citiesP ||= fetch('data/pt/cities.json').then((r) => r.json()).catch(() => { citiesP = null; return []; }));
async function nearestCity(lat, lon) {
  const list = await loadCities();
  let best = null, bd = Infinity;
  for (const c of list) { const d = distKm(lat, lon, c[1], c[2]); if (d < bd) { bd = d; best = c; } }
  return best ? { slug: best[0], d: bd } : null;
}
const ymdStr = (tz, offsetDays = 0) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000)); }
  catch (_) { return ''; }
};
const cityName = (n) => n[lang] || ((lang === 'kk' || lang === 'ky' || lang === 'uz') && n.ru) || n.en || '';
async function loadTimes() {
  const near = await nearestCity(place.lat, place.lon);
  if (!near) throw new Error('no cities');
  const data = await fetch('data/pt/' + near.slug + '.json').then((r) => r.json());
  const i = data.d.indexOf(ymdStr(data.tz, 0));
  if (i < 0 || !data.t[i + 1]) throw new Error('no data for today');
  const toDay = (row) => Object.fromEntries(KEYS.map((k, j) => [k, row[j] ? new Date(row[j]) : null]));
  return { today: toDay(data.t[i]), tomorrow: toDay(data.t[i + 1]), tz: data.tz, city: cityName(data.n), dist: near.d };
}

function fmtCount(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

function nextPrayer() {
  const now = Date.now();
  for (const k of NEXT_KEYS) if (times.today[k] && times.today[k].getTime() > now) return { k, at: times.today[k], day: 0 };
  return { k: 'fajr', at: times.tomorrow.fajr, day: 1 };
}
function prevPrayerTime(np) {
  if (np.day === 1) return times.today.isha;
  const i = NEXT_KEYS.indexOf(np.k);
  return i > 0 ? times.today[NEXT_KEYS[i - 1]] : new Date(times.today.fajr.getTime() - 6 * 3600e3);
}

function renderTimes() {
  if (!times) return;
  const np = nextPrayer();
  const list = $('#times');
  list.innerHTML = '';
  const now = Date.now();
  for (const k of KEYS) {
    const el = document.createElement('div');
    const at = times.today[k];
    el.className = 't' + (np.day === 0 && np.k === k ? ' on' : '') + (at && at.getTime() <= now ? ' past' : '');
    el.innerHTML = `<small></small><b></b>`;
    el.querySelector('small').textContent = t(k);
    el.querySelector('b').textContent = formatTime(at, times.tz);
    list.appendChild(el);
  }
  $('#next-label').textContent = t('until_' + np.k);
  // Если место далеко от города с расписанием — честно пишем, по какому городу время
  const far = times.dist > 15;
  $('#approx').hidden = !far;
  if (far) $('#approx').textContent = t('city_note').replace('{city}', times.city).replace('{km}', String(Math.round(times.dist)));
  updateCount();
}
function updateCount() {
  if (!times) return;
  const np = nextPrayer();
  const left = np.at.getTime() - Date.now();
  if (left <= 0) { renderTimes(); return; }
  $('#count').textContent = fmtCount(left);
  const from = prevPrayerTime(np).getTime();
  const frac = Math.min(1, Math.max(0, (Date.now() - from) / (np.at.getTime() - from)));
  $('#bar').style.width = (frac * 100).toFixed(1) + '%';
}

// Дата по хиджре — готовая таблица (data/pt/hijri.json), посчитанная кодом приложения;
// поправка ±N дней = сдвиг даты, как в приложении.
let hijriP = null;
async function hijriFor(ymd, off) {
  hijriP ||= fetch('data/pt/hijri.json').then((r) => r.json()).catch(() => { hijriP = null; return null; });
  const h = await hijriP;
  if (!h || !ymd) return '';
  const idx = Math.round((Date.parse(ymd + 'T12:00:00Z') - Date.parse(h.d0 + 'T12:00:00Z')) / 86400000) + off;
  const arr = h.h[lang] || h.h.en;
  return (arr && arr[idx]) || '';
}
async function renderDate() {
  if (!place) return;
  const tz = times?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  let g = '';
  // Если браузер не знает язык (бывает с казахским/кыргызским) — русский или английский
  let loc = lang;
  try { if (!Intl.DateTimeFormat.supportedLocalesOf([lang]).length) loc = (lang === 'kk' || lang === 'ky') ? 'ru' : 'en'; } catch (_) {}
  try { g = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now); } catch (_) {}
  const off = +(store.get('hijri') || 0);
  $('#greg').textContent = g;
  $('#hijri').textContent = await hijriFor(ymdStr(tz, 0), off);
  $('#hijri-off').textContent = (off > 0 ? '+' : '') + off;
}

async function showPlace(p, save = true) {
  place = p;
  if (save) store.set('place', JSON.stringify(p));
  $('#place-name').textContent = p.name || '';
  $('#panel').classList.remove('empty');
  $('#times-box').classList.add('loading');
  $('#count').textContent = '··:··:··';
  renderQibla();
  try {
    times = await loadTimes();
    renderTimes();
  } catch (e) {
    console.warn('times failed', e);
  } finally {
    $('#times-box').classList.remove('loading');
  }
  renderDate();
  if (!tick) tick = setInterval(() => { updateCount(); }, 1000);
}

async function placeFromCoords(lat, lon) {
  const np = await nearestPlace(lat, lon);
  return { lat: +lat.toFixed(5), lon: +lon.toFixed(5), name: np ? placeLabel(np) : '', cc: np?.cc && np.cc !== '--' ? np.cc : null, auto: true };
}

function locate() {
  if (!('geolocation' in navigator)) { askCity(); return; }
  $('#place-name').textContent = t('location_detecting');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const p = await placeFromCoords(pos.coords.latitude, pos.coords.longitude);
    showPlace(p);
  }, () => {
    if (!place) askCity(t('geo_denied'));
    else $('#place-name').textContent = place.name;
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 30 * 60000 });
}

function askCity(msg) {
  $('#panel').classList.add('empty');
  $('#empty-msg').textContent = msg || t('choose_city');
  openSearch();
}

// ── Поиск города ─────────────────────────────────────────────────────────────
function openSearch() {
  $('#search').hidden = false;
  $('#q').value = '';
  $('#results').innerHTML = '';
  setTimeout(() => $('#q').focus(), 30);
  loadSearch();
}
function closeSearch() { $('#search').hidden = true; }
let qTimer = null;
async function onQuery() {
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const q = $('#q').value;
    const box = $('#results');
    if (q.trim().length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="muted pad">${t('searching')}</div>`;
    const rows = await search(q);
    box.innerHTML = '';
    if (!rows.length) { box.innerHTML = `<div class="muted pad">${t('nothing_found')}</div>`; return; }
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'res';
      b.innerHTML = '<span></span><small></small>';
      b.querySelector('span').textContent = r[3];
      b.querySelector('small').textContent = (r[4] ? r[4] + ' · ' : '') + r[2];
      b.onclick = () => { closeSearch(); showPlace({ lat: r[0], lon: r[1], name: r[3], cc: r[2], auto: false }); };
      box.appendChild(b);
    }
  }, 180);
}

// ── Кибла ────────────────────────────────────────────────────────────────────
let qiblaDeg = 0, heading = null;
function qiblaBearing(la, lo) {
  const d = Math.PI / 180;
  const y = Math.sin((KAABA[1] - lo) * d);
  const x = Math.cos(la * d) * Math.tan(KAABA[0] * d) - Math.sin(la * d) * Math.cos((KAABA[1] - lo) * d);
  return (Math.atan2(y, x) / d + 360) % 360;
}
function renderQibla() {
  if (!place) return;
  qiblaDeg = qiblaBearing(place.lat, place.lon);
  $('#qibla-deg').textContent = Math.round(qiblaDeg) + '°';
  const km = Math.round(distKm(place.lat, place.lon, KAABA[0], KAABA[1]));
  $('#qibla-km').textContent = `${km.toLocaleString(lang)} ${t('km')} ${t('to_kaaba')}`;
  rotateQibla();
}
function rotateQibla() {
  const rose = heading == null ? 0 : -heading;
  $('#rose').style.transform = `rotate(${rose}deg)`;
  $('#arm').style.transform = `rotate(${qiblaDeg + rose}deg)`;
}
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h == null) return;
  heading = h;
  rotateQibla();
}
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    $('#compass-btn').hidden = true;
    $('#compass-hint').hidden = false;
  } catch (_) {}
}

// ── Хадис дня ────────────────────────────────────────────────────────────────
async function renderHadith() {
  const hl = lang === 'kk' ? 'ru' : lang; // казахского перевода в HadeethEnc нет
  try {
    const list = await fetch('data/hadith/' + hl + '.json').then((r) => r.json());
    const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const [text, ar, grade] = list[day % list.length];
    $('#h-ar').textContent = ar || '';
    $('#h-ar').hidden = !ar;
    $('#h-text').textContent = `«${text}»`;
    $('#h-grade').textContent = grade.replace(/^\[|\]$/g, '');
  } catch (_) {
    $('#hadith').hidden = true;
  }
}

// ── Запуск ───────────────────────────────────────────────────────────────────
async function setLang(l) {
  lang = l;
  store.set('lang', l);
  applyLang();
  renderHadith();
  if (place) {
    // Название места — на новом языке (для найденного поиском города это сам город)
    const np = await nearestPlace(place.lat, place.lon);
    if (np) { place.name = placeLabel(np); store.set('place', JSON.stringify(place)); }
    $('#place-name').textContent = place.name || '';
    renderTimes();
    renderDate();
    renderQibla();
  }
}

async function main() {
  I = await fetch('assets/i18n.json').then((r) => r.json());
  lang = pickLang();
  applyLang();

  const menu = $('#lang-menu');
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.l = l; b.textContent = LANG_NAMES[l];
    b.onclick = () => { menu.hidden = true; setLang(l); };
    menu.appendChild(b);
  }
  $('#lang-btn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; });
  applyLang();

  $('#change').onclick = openSearch;
  $('#empty-search').onclick = openSearch;
  $('#empty-locate').onclick = () => { closeSearch(); locate(); };
  $('#locate').onclick = () => { closeSearch(); locate(); };
  $('#close-search').onclick = closeSearch;
  $('#q').addEventListener('input', onQuery);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });

  $('#hijri-btn').onclick = () => { $('#hijri-box').hidden = !$('#hijri-box').hidden; };
  const shift = (d) => {
    const v = Math.max(-3, Math.min(3, +(store.get('hijri') || 0) + d));
    store.set('hijri', String(v));
    renderDate();
  };
  $('#hijri-minus').onclick = () => shift(-1);
  $('#hijri-plus').onclick = () => shift(1);
  $('#hijri-done').onclick = () => { $('#hijri-box').hidden = true; };

  const touch = matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window;
  $('#compass-btn').hidden = !touch;
  $('#compass-btn').onclick = enableCompass;

  renderHadith();

  let saved = null;
  try { saved = JSON.parse(store.get('place') || 'null'); } catch (_) {}
  if (saved && typeof saved.lat === 'number') {
    showPlace(saved, false);
  } else {
    $('#panel').classList.add('empty');
    $('#empty-msg').textContent = t('choose_city');
    locate();
  }

  // Новый день — пересчитать
  setInterval(() => { if (place) { const d = new Date().getDate(); if (d !== main._d) { main._d = d; showPlace(place, false); } } }, 60000);
  main._d = new Date().getDate();
}

main();
