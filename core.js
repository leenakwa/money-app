/* Pure calculations and validation. No network, no dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAILY_BUDGET = 500;
  const WEEKLY_BUDGET = 3500;
  const VERSION = 1;
  const MAX_AMOUNT = 100000000;
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dateOf = key => { const [y, m, d] = String(key).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  function isDateKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const d = dateOf(key);
    return !Number.isNaN(d.getTime()) && keyOf(d) === key && key >= '1900-01-01' && key <= '9999-12-31';
  }
  function todayKey(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  function addDays(key, count) {
    const d = dateOf(key);
    d.setUTCDate(d.getUTCDate() + count);
    return keyOf(d);
  }
  function weekStart(key) {
    return addDays(key, -((dateOf(key).getUTCDay() + 6) % 7));
  }
  function weekDates(key) {
    const start = weekStart(key);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  function monthStart(key) { return `${key.slice(0, 7)}-01`; }
  function shiftMonth(key, count) {
    const d = dateOf(monthStart(key));
    d.setUTCMonth(d.getUTCMonth() + count);
    return keyOf(d);
  }
  function monthDays(key) {
    const first = weekStart(monthStart(key));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }
  function cleanName(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' '); }
  function nameKey(value) { return cleanName(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'); }
  function parseMoney(value) {
    const s = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(s)) return null;
    const [whole, fraction = ''] = s.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_AMOUNT ? cents : null;
  }
  const euroFormatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(cents) { return euroFormatter.format(cents / 100).replace(/-/g, '−'); }
  function inputMoney(cents) { return `${Math.floor(cents / 100)},${pad(cents % 100)}`; }
  function totals(entries, start, end = start) {
    let bought = 0, planned = 0, boughtCount = 0, plannedCount = 0;
    for (const entry of entries) {
      if (entry.date < start || entry.date > end) continue;
      if (entry.status === 'bought') { bought += entry.amountCents; boughtCount++; }
      else { planned += entry.amountCents; plannedCount++; }
    }
    return { bought, planned, boughtCount, plannedCount, total: bought + planned };
  }
  function emptyState() { return { schema: 'nedelya-budget', version: VERSION, entries: [], catalog: [], lastExportAt: null }; }
  function validTime(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
  function canonicalTime(value) { return new Date(value).toISOString(); }
  function validateState(raw) {
    if (!raw || typeof raw !== 'object' || raw.schema !== 'nedelya-budget' || raw.version !== VERSION || !Array.isArray(raw.entries) || !Array.isArray(raw.catalog)) {
      throw new Error('Это не резервная копия «Расходов» или версия файла не поддерживается.');
    }
    if (raw.entries.length > 100000 || raw.catalog.length > 100000) throw new Error('В файле слишком много записей.');
    const ids = new Set();
    const entries = raw.entries.map((e, i) => {
      if (!e || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id) || ids.has(e.id)
          || typeof e.name !== 'string' || !cleanName(e.name) || cleanName(e.name).length > 120
          || !Number.isSafeInteger(e.amountCents) || e.amountCents < 0 || e.amountCents > MAX_AMOUNT
          || !isDateKey(e.date) || !['bought', 'planned'].includes(e.status)
          || !validTime(e.createdAt) || !validTime(e.updatedAt)) {
        throw new Error(`Некорректная запись №${i + 1}. Текущие данные не изменены.`);
      }
      ids.add(e.id);
      return { id: e.id, name: cleanName(e.name), amountCents: e.amountCents, date: e.date, status: e.status, createdAt: canonicalTime(e.createdAt), updatedAt: canonicalTime(e.updatedAt) };
    });
    const catalogMap = new Map();
    for (const c of raw.catalog) {
      if (!c || typeof c.name !== 'string' || !cleanName(c.name) || cleanName(c.name).length > 120
          || !Number.isSafeInteger(c.priceCents) || c.priceCents < 0 || c.priceCents > MAX_AMOUNT
          || !isDateKey(c.lastPurchasedDate) || !validTime(c.updatedAt)) throw new Error('В файле повреждён быстрый набор. Текущие данные не изменены.');
      const next = { key: nameKey(c.name), name: cleanName(c.name), priceCents: c.priceCents, lastPurchasedDate: c.lastPurchasedDate, updatedAt: canonicalTime(c.updatedAt) };
      const old = catalogMap.get(next.key);
      if (!old || compareCatalog(next, old) >= 0) catalogMap.set(next.key, next);
    }
    const result = { schema: 'nedelya-budget', version: VERSION, entries, catalog: [...catalogMap.values()], lastExportAt: validTime(raw.lastExportAt) ? canonicalTime(raw.lastExportAt) : null };
    // Recover suggestions from bought records even if a backup has an empty catalog.
    for (const e of entries) if (e.status === 'bought') recordPurchase(result, e);
    return result;
  }
  function compareCatalog(a, b) {
    return a.lastPurchasedDate.localeCompare(b.lastPurchasedDate) || a.updatedAt.localeCompare(b.updatedAt);
  }
  function recordPurchase(state, entry) {
    if (entry.status !== 'bought') return;
    const key = nameKey(entry.name);
    const candidate = { key, name: entry.name, priceCents: entry.amountCents, lastPurchasedDate: entry.date, updatedAt: entry.updatedAt };
    const index = state.catalog.findIndex(c => c.key === key);
    if (index === -1) state.catalog.push(candidate);
    else if (compareCatalog(candidate, state.catalog[index]) >= 0) state.catalog[index] = candidate;
  }
  function mergeStates(current, imported) {
    const result = validateState(current);
    const incoming = validateState(imported);
    const entries = new Map(result.entries.map(e => [e.id, e]));
    for (const e of incoming.entries) if (!entries.has(e.id) || e.updatedAt > entries.get(e.id).updatedAt) entries.set(e.id, e);
    result.entries = [...entries.values()];
    const catalog = new Map(result.catalog.map(c => [c.key, c]));
    for (const c of incoming.catalog) if (!catalog.has(c.key) || compareCatalog(c, catalog.get(c.key)) > 0) catalog.set(c.key, c);
    result.catalog = [...catalog.values()];
    for (const e of result.entries) recordPurchase(result, e);
    return result;
  }
  function sortedCatalog(catalog, query = '') {
    const key = nameKey(query);
    return catalog.filter(c => c.key.includes(key)).sort((a, b) => {
      const starts = Number(b.key.startsWith(key)) - Number(a.key.startsWith(key));
      return starts || compareCatalog(b, a) || a.name.localeCompare(b.name, 'ru');
    });
  }
  return { DAILY_BUDGET, WEEKLY_BUDGET, VERSION, MAX_AMOUNT, keyOf, dateOf, isDateKey, todayKey, addDays, weekStart, weekDates, monthStart, shiftMonth, monthDays, cleanName, nameKey, parseMoney, money, inputMoney, totals, emptyState, validateState, recordPurchase, mergeStates, sortedCatalog };
});
