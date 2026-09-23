/* A small, local-first expense calendar. All amounts are integer eurocents. */
(function () {
  'use strict';
  const C = window.BudgetCore;
  const $ = id => document.getElementById(id);
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const weekdays = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  const fullWeekdays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const dateLabel = (key, options = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(C.dateOf(key));
  const countLabel = (n, one, few, many) => `${n} ${n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many}`;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const storageKey = `nedelya-budget:v1:${new URL('.', document.baseURI).pathname}`;
  const uuid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  let recoveryRaw = null;
  let state = C.emptyState();
  let currentToday = C.todayKey();
  let selectedDate = C.isDateKey(location.hash.slice(1)) ? location.hash.slice(1) : currentToday;
  let currentWeek = C.weekStart(selectedDate);
  let currentMonth = C.monthStart(selectedDate);
  let editingId = null;
  let editingVersion = null;
  let undoAction = null;
  let toastTimeout;
  let confirmAction = null;

  function storageWarning(message, recovery = false) {
    $('storage-warning').hidden = false;
    $('storage-warning').innerHTML = `${escape(message)}${recovery ? ' <button type="button" id="recover-data">Скачать исходные данные</button>' : ''}`;
    $('save-status').textContent = 'Есть проблема с сохранением';
    if (recovery) $('recover-data').onclick = () => download(recoveryRaw, `raskhody-recovery-${C.todayKey()}.json`, 'application/json');
  }
  function readStored() {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return C.emptyState();
    try { return C.validateState(JSON.parse(raw)); }
    catch (error) {
      recoveryRaw = raw;
      storageWarning('Локальные данные не удалось прочитать. Они не перезаписаны. Скачай исходный файл; восстановить проверенную копию можно в «Данных».', true);
      throw error;
    }
  }
  try { state = readStored(); }
  catch (error) {
    if (recoveryRaw === null) storageWarning('Браузер не разрешает локальное сохранение. Разреши хранение данных сайта и открой страницу снова. Записи без сохранения добавляться не будут.');
  }

  /** Re-read before each mutation so changes in other tabs are not casually overwritten. */
  function mutate(action, { replaceDamaged = false } = {}) {
    try {
      const fresh = replaceDamaged ? C.emptyState() : readStored();
      const draft = clone(fresh);
      const next = action(draft) || draft;
      const checked = C.validateState(next);
      localStorage.setItem(storageKey, JSON.stringify(checked));
      state = checked;
      recoveryRaw = null;
      $('storage-warning').hidden = true;
      $('save-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Сохраняется в этом браузере';
      renderAll();
      return true;
    } catch (error) {
      if (error.name === 'QuotaExceededError' || error.name === 'SecurityError') {
        storageWarning('Не удалось сохранить: память браузера заполнена или хранение запрещено. Текущие записи не изменены. Скачай резервную копию в «Данных» и проверь настройки браузера.');
      }
      showToast(error.message || 'Не удалось сохранить. Текущие записи не изменены.');
      return false;
    }
  }
  function changeDate(key) {
    if (!C.isDateKey(key)) return;
    selectedDate = key;
    currentWeek = C.weekStart(key);
    try { history.replaceState(null, '', `#${key}`); } catch (_) { /* file: previews may limit History. */ }
    renderAll();
  }
  function moveWeek(direction) {
    const next = C.addDays(selectedDate, direction * 7);
    if (C.isDateKey(next)) changeDate(next);
  }
  function weekHeading() {
    const end = C.addDays(currentWeek, 6);
    const sameMonth = currentWeek.slice(0, 7) === end.slice(0, 7);
    const sameYear = currentWeek.slice(0, 4) === end.slice(0, 4);
    const range = sameMonth ? `${C.dateOf(currentWeek).getUTCDate()} — ${dateLabel(end)}` : `${dateLabel(currentWeek, { day: 'numeric', month: 'short' })} — ${dateLabel(end, { day: 'numeric', month: 'short' })}`;
    const year = sameYear ? currentWeek.slice(0, 4) : `${currentWeek.slice(0, 4)} / ${end.slice(0, 4)}`;
    return `${escape(range)}<span class="week-year">${year}</span>`;
  }
  function progressHTML(bought, planned, budget) {
    const b = Math.min(100, bought / budget * 100);
    const p = Math.max(0, Math.min(100 - b, planned / budget * 100));
    return `<span class="bar-bought" style="width:${b}%" aria-hidden="true"></span><span class="bar-planned" style="width:${p}%" aria-hidden="true"></span>`;
  }
  function renderSummary() {
    const t = C.totals(state.entries, currentWeek, C.addDays(currentWeek, 6));
    const remain = C.WEEKLY_BUDGET - t.bought;
    const forecast = remain - t.planned;
    $('summary').innerHTML = `
      <div class="metric balance ${remain < 0 ? 'over' : ''}"><p class="metric-label">${remain < 0 ? 'Перерасход за неделю' : 'Осталось на неделю'}</p><p class="metric-value" id="week-remaining" data-cents="${remain}">${C.money(Math.abs(remain))}</p><p class="metric-note">Потрачено ${C.money(t.bought)} из ${C.money(C.WEEKLY_BUDGET)}</p></div>
      <div class="metric spent"><p class="metric-label">Потрачено за неделю</p><p class="metric-value" id="week-spent" data-cents="${t.bought}">${C.money(t.bought)}</p><p class="metric-note">${countLabel(t.boughtCount, 'покупка', 'покупки', 'покупок')} · только купленное</p></div>
      <div class="metric forecast"><p class="metric-label">${forecast < 0 ? 'Перерасход с планами' : 'Остаток с планами'}</p><p class="metric-value" id="week-forecast" data-cents="${forecast}">${C.money(Math.abs(forecast))}</p><p class="metric-note">${t.plannedCount ? `Ещё ${C.money(t.planned)} запланировано` : 'Пока без запланированных покупок'}</p></div>`;
    $('week-progress').innerHTML = progressHTML(t.bought, t.planned, C.WEEKLY_BUDGET);
    $('week-progress').setAttribute('role', 'img');
    $('week-progress').setAttribute('aria-label', `Потрачено ${C.money(t.bought)}, запланировано ${C.money(t.planned)}, бюджет ${C.money(C.WEEKLY_BUDGET)}`);
  }
  function entryHTML(e) {
    const bought = e.status === 'bought';
    return `<li class="purchase-row ${bought ? '' : 'is-planned'}" data-entry-id="${e.id}">
      <button type="button" class="purchase-toggle" role="checkbox" aria-checked="${bought}" data-toggle-id="${e.id}" aria-label="${escape(e.name)}: ${bought ? 'куплено; перенести в планы' : 'в планах; отметить купленным'}" title="${bought ? 'Перенести в планы' : 'Отметить купленным'}">${bought ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6 2.2 2.2 4.8-4.8"/></svg>' : ''}</button>
      <button type="button" class="item-edit" data-edit-id="${e.id}" aria-label="Изменить: ${escape(e.name)}, ${C.money(e.amountCents)}"><span class="item-name">${escape(e.name)}</span><span class="item-amount">${C.money(e.amountCents)}</span></button>
    </li>`;
  }
  function renderWeek() {
    const days = C.weekDates(currentWeek);
    $('week-title').innerHTML = weekHeading();
    $('prev-week').disabled = !C.isDateKey(C.addDays(currentWeek, -7));
    $('next-week').disabled = !C.isDateKey(C.addDays(currentWeek, 7));
    $('mobile-day-tabs').innerHTML = days.map((date, index) => `<button type="button" class="mobile-day-tab ${date === selectedDate ? 'selected' : ''} ${date === currentToday ? 'is-today' : ''}" data-select-date="${date}" aria-label="${fullWeekdays[index]}, ${dateLabel(date)}" aria-pressed="${date === selectedDate}"><span>${weekdays[index]}</span><span>${C.dateOf(date).getUTCDate()}</span></button>`).join('');
    $('week-grid').innerHTML = days.map((date, index) => {
      const items = state.entries.filter(e => e.date === date).sort((a, b) => Number(a.status === 'planned') - Number(b.status === 'planned') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const t = C.totals(items, date);
      const remaining = C.DAILY_BUDGET - t.bought;
      const forecast = remaining - t.planned;
      const today = date === currentToday;
      const month = C.dateOf(date).getUTCDate() === 1 ? `<span class="day-month">${escape(dateLabel(date, { month: 'short' }))}</span>` : '';
      return `<section class="day-card ${today ? 'is-today' : ''} ${date === selectedDate ? 'selected' : ''}" data-date="${date}" aria-label="${fullWeekdays[index]}, ${dateLabel(date)}">
        <div class="day-head"><div><h3 class="day-topline"><span>${weekdays[index]}</span>${today ? '<span class="today-tag">сегодня</span>' : ''}</h3><time datetime="${date}" class="day-number">${C.dateOf(date).getUTCDate()}${month}</time></div><div class="day-head-balance"><span>${remaining < 0 ? 'Перерасход' : 'Осталось на день'}</span><strong>${C.money(Math.abs(remaining))}</strong>${t.plannedCount ? `<small>С планами ${C.money(forecast)}</small>` : ''}</div><button type="button" class="day-add-icon" data-add-date="${date}" aria-label="Добавить айтем на ${dateLabel(date)}">+</button></div>
        <ul class="item-list">${items.length ? items.map(entryHTML).join('') : '<li class="day-empty">Пока пусто</li>'}</ul>
        <button type="button" class="inline-add" data-add-date="${date}">+ Добавить</button>
        <div class="day-totals"><div class="day-total-row"><span>Потрачено</span><span>${C.money(t.bought)}</span></div>${t.plannedCount ? `<div class="day-total-row planned-total"><span>В планах</span><span>${C.money(t.planned)}</span></div>` : '<div class="day-total-row total-spacer" aria-hidden="true"><span>В планах</span><span>—</span></div>'}
          <div class="day-total-row day-remaining ${remaining < 0 ? 'is-over' : ''}"><span>${remaining < 0 ? 'Перерасход' : 'Осталось'}</span><span data-day-remaining="${remaining}">${C.money(Math.abs(remaining))}</span></div>
          ${t.plannedCount ? `<div class="day-total-row day-forecast" title="${forecast < 0 ? 'С учётом планов будет перерасход' : 'Остаток после всех запланированных покупок'}"><span>С планами</span><span data-day-forecast="${forecast}">${C.money(forecast)}</span></div>` : '<div class="day-total-row day-forecast total-spacer" aria-hidden="true"><span>С планами</span><span>—</span></div>'}
          <div class="day-mini-progress" aria-hidden="true">${progressHTML(t.bought, t.planned, C.DAILY_BUDGET)}</div>
        </div></section>`;
    }).join('');
  }
  function renderAll() {
    renderSummary();
    renderWeek();
    $('catalog-count').textContent = state.catalog.length;
    if ($('month-dialog').open) renderMonth();
    if ($('library-dialog').open) renderLibrary();
    if ($('data-dialog').open) renderData();
    if ($('item-dialog').open) updateFormPreview();
  }

  function openItem({ date = selectedDate, entry = null, catalogItem = null } = {}) {
    editingId = entry?.id || null;
    editingVersion = entry?.updatedAt || null;
    $('item-form').reset();
    $('item-error').hidden = true;
    ['item-name', 'item-price', 'item-date'].forEach(id => $(id).removeAttribute('aria-invalid'));
    $('item-dialog-title').textContent = entry ? 'Изменить айтем' : 'Добавить айтем';
    $('item-dialog-kicker').textContent = entry ? 'РЕДАКТИРОВАНИЕ' : 'ПОКУПКИ И ПЛАНЫ';
    $('item-name').value = entry?.name || catalogItem?.name || '';
    $('item-price').value = entry ? C.inputMoney(entry.amountCents) : catalogItem ? C.inputMoney(catalogItem.priceCents) : '';
    $('item-date').value = entry?.date || date;
    $('item-form').querySelector(`input[name="status"][value="${entry?.status || 'bought'}"]`).checked = true;
    $('save-item').textContent = entry ? 'Сохранить' : 'Добавить';
    $('save-another').hidden = Boolean(entry);
    $('delete-item').hidden = !entry;
    renderSuggestions();
    updateFormPreview();
    $('item-dialog').showModal();
    requestAnimationFrame(() => (catalogItem ? $('item-price') : $('item-name')).focus());
  }
  function renderSuggestions() {
    const query = $('item-name').value;
    const results = C.sortedCatalog(state.catalog, query);
    const visible = query.trim() ? results : results.slice(0, 8);
    $('suggestion-label').textContent = query.trim() ? 'Из быстрого набора' : 'Из прошлых покупок';
    $('suggestion-count').textContent = results.length ? visible.length < results.length ? `${visible.length} из ${results.length}` : String(results.length) : '';
    $('suggestions').innerHTML = visible.length ? visible.map(c => `<button type="button" class="suggestion" data-catalog-key="${escape(c.key)}"><span>${escape(c.name)}</span><span class="suggestion-price">${C.money(c.priceCents)} <span aria-hidden="true">↗</span></span></button>`).join('') : `<p class="suggestions-empty">${state.catalog.length ? 'Новый айтем. После покупки он появится здесь.' : 'Купленные айтемы будут появляться здесь автоматически.'}</p>`;
  }
  function formStatus() { return $('item-form').querySelector('input[name="status"]:checked').value; }
  function updateFormPreview() {
    const price = C.parseMoney($('item-price').value);
    const date = $('item-date').value;
    if (!C.isDateKey(date)) { $('form-preview').innerHTML = ''; return; }
    const existing = state.entries.filter(e => e.id !== editingId);
    const day = C.totals(existing, date);
    const start = C.weekStart(date);
    const week = C.totals(existing, start, C.addDays(start, 6));
    const planned = formStatus() === 'planned';
    const amount = price === null ? 0 : price;
    const baseDay = C.DAILY_BUDGET - day.bought - (planned ? day.planned : 0) - amount;
    const baseWeek = C.WEEKLY_BUDGET - week.bought - (planned ? week.planned : 0) - amount;
    const label = value => `${value < 0 ? 'Перерасход' : 'Остаток'}: ${C.money(Math.abs(value))}`;
    $('form-preview').classList.toggle('is-planned', planned);
    $('form-preview').innerHTML = `<div>${planned ? 'День · с учётом всех планов' : 'День · после этой покупки'}<strong>${label(baseDay)}</strong>${!planned && day.plannedCount ? `<span class="preview-detail">С планами: ${C.money(baseDay - day.planned)}</span>` : ''}</div><div>${planned ? 'Неделя · с учётом всех планов' : 'Неделя · после этой покупки'}<strong>${label(baseWeek)}</strong>${!planned && week.plannedCount ? `<span class="preview-detail">С планами: ${C.money(baseWeek - week.planned)}</span>` : ''}</div>`;
  }
  function formError(message, field) {
    $('item-error').textContent = message;
    $('item-error').hidden = false;
    if (field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }
  function saveItem(event) {
    event.preventDefault();
    $('item-error').hidden = true;
    ['item-name', 'item-price', 'item-date'].forEach(id => $(id).removeAttribute('aria-invalid'));
    const name = C.cleanName($('item-name').value);
    const amountCents = C.parseMoney($('item-price').value);
    const date = $('item-date').value;
    const status = formStatus();
    if (!name || name.length > 120) return formError('Напиши название: от 1 до 120 символов.', 'item-name');
    if (amountCents === null) return formError('Введи стоимость от 0 до 1 000 000 €: например, 2,50. Не больше двух знаков после запятой.', 'item-price');
    if (!C.isDateKey(date)) return formError('Выбери корректную дату.', 'item-date');
    const wasEdit = Boolean(editingId);
    const id = editingId || uuid();
    const now = new Date().toISOString();
    const oldDate = selectedDate;
    const success = mutate(draft => {
      const index = draft.entries.findIndex(e => e.id === id);
      if (wasEdit && index === -1) throw new Error('Этот айтем удалён в другой вкладке. Закрой окно и добавь его заново.');
      if (wasEdit && draft.entries[index].updatedAt !== editingVersion) throw new Error('Этот айтем изменён в другой вкладке. Открой его заново, чтобы не потерять изменения.');
      const entry = { id, name, amountCents, date, status, createdAt: index === -1 ? now : draft.entries[index].createdAt, updatedAt: now };
      if (index === -1) draft.entries.push(entry); else draft.entries[index] = entry;
      C.recordPurchase(draft, entry);
    });
    if (!success) return formError('Запись не сохранена. Проверь уведомление о причине ошибки.');
    if (date !== oldDate) changeDate(date);
    if (event.submitter?.value === 'another' && !wasEdit) {
      editingId = null;
      editingVersion = null;
      $('item-name').value = '';
      $('item-price').value = '';
      renderSuggestions();
      updateFormPreview();
      $('item-name').focus();
      showToast(status === 'planned' ? 'План добавлен. Можно следующий.' : 'Покупка добавлена. Можно следующую.');
    } else {
      $('item-dialog').close();
      showToast(wasEdit ? 'Изменения сохранены' : status === 'planned' ? 'Добавлено в планы' : 'Покупка добавлена');
    }
  }
  function toggleEntry(id) {
    let nextStatus = '';
    if (mutate(draft => {
      const e = draft.entries.find(e => e.id === id);
      if (!e) throw new Error('Айтем уже удалён.');
      nextStatus = e.status === 'bought' ? 'planned' : 'bought';
      e.status = nextStatus;
      e.updatedAt = new Date().toISOString();
      C.recordPurchase(draft, e);
    })) {
      const checkbox = document.querySelector(`[data-toggle-id="${id}"]`);
      checkbox?.focus({ preventScroll: true });
      showToast(nextStatus === 'bought' ? 'Отмечено как купленное' : 'Перенесено в планы');
    }
  }
  function askConfirmation(title, description, action, button = 'Продолжить') {
    $('confirm-title').textContent = title;
    $('confirm-description').textContent = description;
    $('confirm-ok').textContent = button;
    confirmAction = action;
    $('confirm-dialog').showModal();
    $('confirm-cancel').focus();
  }
  function deleteEntry() {
    const current = state.entries.find(e => e.id === editingId);
    if (!current) return;
    const id = current.id;
    const version = editingVersion;
    askConfirmation('Удалить айтем?', `«${current.name}» исчезнет из календаря. Если айтем уже был куплен, он останется в быстром наборе.`, () => {
      let removed;
      if (mutate(draft => {
        const index = draft.entries.findIndex(e => e.id === id);
        if (index === -1) throw new Error('Айтем уже удалён.');
        if (draft.entries[index].updatedAt !== version) throw new Error('Айтем изменён в другой вкладке. Открой его заново перед удалением.');
        removed = draft.entries.splice(index, 1)[0];
      })) {
        $('item-dialog').close();
        showToast('Айтем удалён', () => {
          if (mutate(draft => {
            if (!draft.entries.some(e => e.id === removed.id)) draft.entries.push({ ...removed, updatedAt: new Date().toISOString() });
          })) showToast('Айтем возвращён');
        });
      }
    }, 'Удалить');
  }

  function renderMonth() {
    const key = currentMonth.slice(0, 7);
    const title = dateLabel(currentMonth, { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
    $('month-title').textContent = title[0].toLocaleUpperCase('ru-RU') + title.slice(1);
    $('prev-month').disabled = !C.isDateKey(C.shiftMonth(currentMonth, -1));
    $('next-month').disabled = !C.isDateKey(C.shiftMonth(currentMonth, 1));
    const weekEnd = C.addDays(currentWeek, 6);
    $('month-grid').innerHTML = C.monthDays(currentMonth).map(date => {
      const t = C.totals(state.entries, date);
      const inMonth = date.slice(0, 7) === key;
      const selected = date === selectedDate;
      return `<button type="button" class="month-day ${inMonth ? '' : 'outside'} ${date === currentToday ? 'is-today' : ''} ${selected ? 'selected' : ''} ${date >= currentWeek && date <= weekEnd ? 'in-week' : ''} ${t.bought > C.DAILY_BUDGET ? 'over-budget' : ''}" data-month-date="${date}" aria-pressed="${selected}" aria-label="${dateLabel(date, { day: 'numeric', month: 'long', year: 'numeric' })}; потрачено ${C.money(t.bought)}; в планах ${C.money(t.planned)}${t.bought > C.DAILY_BUDGET ? `; перерасход ${C.money(t.bought - C.DAILY_BUDGET)}` : ''}" ${C.isDateKey(date) ? '' : 'disabled'}><span class="month-day-number">${C.dateOf(date).getUTCDate()}</span><span class="month-markers" aria-hidden="true">${t.boughtCount ? '<i class="mini-dot"></i>' : ''}${t.plannedCount ? '<i class="mini-dot plan-dot"></i>' : ''}</span></button>`;
    }).join('');
    const monthEnd = C.addDays(C.shiftMonth(currentMonth, 1), -1);
    const totals = C.totals(state.entries, currentMonth, monthEnd);
    $('month-summary').innerHTML = `<div><span>Куплено за месяц</span><span>${C.money(totals.bought)}</span></div><div class="muted"><span>Запланировано</span><span>${C.money(totals.planned)}</span></div>`;
  }
  function openMonth() { currentMonth = C.monthStart(selectedDate); renderMonth(); $('month-dialog').showModal(); }
  function renderLibrary() {
    const matches = C.sortedCatalog(state.catalog, $('library-search').value);
    $('library-count').textContent = `${matches.length} / ${state.catalog.length}`;
    $('library-list').innerHTML = matches.length ? matches.map(c => `<button type="button" class="library-item" data-library-key="${escape(c.key)}"><span><span class="library-item-name">${escape(c.name)}</span><span class="library-item-date">Куплено ${escape(dateLabel(c.lastPurchasedDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></span><span class="library-item-price">${C.money(c.priceCents)}</span></button>`).join('') : `<p class="library-empty">${state.catalog.length ? 'Ничего не найдено.<br>Попробуй другое название.' : 'Пока здесь пусто.<br>Добавь первую покупку — и она останется в быстром наборе.'}</p>`;
  }
  function openLibrary() { $('library-search').value = ''; renderLibrary(); $('library-dialog').showModal(); $('library-search').focus(); }
  function renderData() {
    const bought = state.entries.filter(e => e.status === 'bought').length;
    const planned = state.entries.length - bought;
    $('data-stats').innerHTML = `<span><strong>${bought}</strong> куплено</span><span><strong>${planned}</strong> в планах</span><span><strong>${state.catalog.length}</strong> в наборе</span>`;
    $('last-export').textContent = state.lastExportAt ? `Последняя копия: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.lastExportAt))}` : 'Резервная копия ещё не создавалась.';
  }
  function openData() { $('import-error').hidden = true; renderData(); $('data-dialog').showModal(); }
  function download(text, filename, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function exportData() {
    if (recoveryRaw !== null) {
      download(recoveryRaw, `raskhody-recovery-${C.todayKey()}.json`, 'application/json');
      showToast('Скачан исходный файл. Это не проверенная резервная копия.');
      return;
    }
    try { state = readStored(); } catch (_) { /* Keep the in-memory copy available for rescue. */ }
    if (recoveryRaw !== null) return exportData();
    const now = new Date().toISOString();
    const exported = { ...clone(state), exportedAt: now, lastExportAt: now };
    download(JSON.stringify(exported, null, 2), `raskhody-${C.todayKey()}-${now.slice(11, 19).replace(/:/g, '')}.json`, 'application/json');
    mutate(draft => { draft.lastExportAt = now; });
    showToast('Резервная копия скачана');
  }
  async function importFile(file) {
    $('import-error').hidden = true;
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Файл слишком большой. Максимум — 10 МБ.');
      const text = (await file.text()).replace(/^\uFEFF/, '');
      let raw;
      try { raw = JSON.parse(text); } catch (_) { throw new Error('Не удалось прочитать JSON-файл. Текущие данные не изменены.'); }
      const incoming = C.validateState(raw);
      const damaged = recoveryRaw !== null;
      askConfirmation(damaged ? 'Восстановить данные?' : 'Добавить данные из копии?', damaged ? `В копии ${incoming.entries.length} записей. Она заменит нечитаемые локальные данные. Сначала сохрани их исходный файл через предупреждение на главной странице.` : `В копии ${incoming.entries.length} записей и ${incoming.catalog.length} айтемов в быстром наборе. Данные объединятся; записи с одинаковым ID не продублируются. Удалённые записи из старой копии вернутся.`, () => {
        if (mutate(draft => C.mergeStates(draft, incoming), { replaceDamaged: damaged })) {
          $('data-dialog').close();
          showToast('Данные из копии добавлены');
        }
      }, damaged ? 'Восстановить' : 'Объединить');
    } catch (error) {
      $('import-error').textContent = error.message;
      $('import-error').hidden = false;
    } finally { $('import-file').value = ''; }
  }
  function showToast(message, undo = null) {
    clearTimeout(toastTimeout);
    $('toast-message').textContent = message;
    $('toast-undo').hidden = !undo;
    undoAction = undo;
    $('toast').hidden = false;
    // Keep form confirmations visible in the browser's top layer without blocking input.
    const activeDialogs = [...document.querySelectorAll('dialog[open]')];
    (activeDialogs.at(-1) || document.body).appendChild($('toast'));
    toastTimeout = setTimeout(hideToast, undo ? 10000 : 4200);
  }
  function hideToast() { $('toast').hidden = true; undoAction = null; clearTimeout(toastTimeout); }

  $('prev-week').onclick = () => moveWeek(-1);
  $('next-week').onclick = () => moveWeek(1);
  $('today-button').onclick = () => changeDate(C.todayKey());
  $('home-link').onclick = event => { event.preventDefault(); changeDate(C.todayKey()); };
  $('add-main').onclick = () => openItem();
  $('open-calendar').onclick = openMonth;
  $('open-library').onclick = openLibrary;
  $('open-data').onclick = openData;
  $('backup-footer').onclick = exportData;
  $('export-data').onclick = exportData;
  $('import-data').onclick = () => $('import-file').click();
  $('import-file').onchange = event => importFile(event.target.files[0]);
  $('item-form').onsubmit = saveItem;
  $('item-form').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input[type="text"]') && !event.isComposing) { event.preventDefault(); $('item-form').requestSubmit($('save-item')); }
  });
  $('delete-item').onclick = deleteEntry;
  $('library-search').oninput = renderLibrary;
  $('item-name').oninput = () => { renderSuggestions(); $('item-name').removeAttribute('aria-invalid'); };
  ['item-price', 'item-date'].forEach(id => $(id).addEventListener('input', () => { $(id).removeAttribute('aria-invalid'); updateFormPreview(); }));
  $('item-form').querySelectorAll('input[name="status"]').forEach(input => input.onchange = updateFormPreview);
  $('prev-month').onclick = () => { currentMonth = C.shiftMonth(currentMonth, -1); renderMonth(); };
  $('next-month').onclick = () => { currentMonth = C.shiftMonth(currentMonth, 1); renderMonth(); };
  $('month-today').onclick = () => { $('month-dialog').close(); changeDate(C.todayKey()); };
  $('confirm-cancel').onclick = () => { confirmAction = null; $('confirm-dialog').close(); };
  $('confirm-ok').onclick = () => { const action = confirmAction; confirmAction = null; $('confirm-dialog').close(); action?.(); };
  $('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });
  $('toast-close').onclick = hideToast;
  $('toast-undo').onclick = () => { const action = undoAction; hideToast(); action?.(); };
  $('week-grid').addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.addDate) { changeDate(target.dataset.addDate); openItem({ date: target.dataset.addDate }); }
    else if (target.dataset.editId) { const entry = state.entries.find(e => e.id === target.dataset.editId); if (entry) openItem({ entry }); }
    else if (target.dataset.toggleId) toggleEntry(target.dataset.toggleId);
  });
  $('mobile-day-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-select-date]');
    if (button) { changeDate(button.dataset.selectDate); document.querySelector(`[data-select-date="${selectedDate}"]`)?.focus({ preventScroll: true }); }
  });
  $('month-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-month-date]');
    if (button && !button.disabled) { $('month-dialog').close(); changeDate(button.dataset.monthDate); }
  });
  $('suggestions').addEventListener('click', event => {
    const button = event.target.closest('[data-catalog-key]');
    const item = button && state.catalog.find(c => c.key === button.dataset.catalogKey);
    if (item) { $('item-name').value = item.name; $('item-price').value = C.inputMoney(item.priceCents); $('item-price').focus(); $('item-price').select(); renderSuggestions(); updateFormPreview(); }
  });
  $('library-list').addEventListener('click', event => {
    const button = event.target.closest('[data-library-key]');
    const item = button && state.catalog.find(c => c.key === button.dataset.libraryKey);
    if (item) { $('library-dialog').close(); openItem({ catalogItem: item }); }
  });
  $('item-name').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && $('suggestions').querySelector('button')) { event.preventDefault(); $('suggestions').querySelector('button').focus(); }
  });
  $('suggestions').addEventListener('keydown', event => {
    const buttons = [...$('suggestions').querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[Math.min(buttons.length - 1, index + 1)]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) $('item-name').focus(); else buttons[index - 1].focus(); }
  });
  document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => {
    let startedOnBackdrop = false;
    dialog.addEventListener('pointerdown', event => {
      const r = dialog.getBoundingClientRect();
      startedOnBackdrop = event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom);
    });
    dialog.addEventListener('click', event => {
      const r = dialog.getBoundingClientRect();
      if (startedOnBackdrop && event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
      startedOnBackdrop = false;
    });
    dialog.addEventListener('close', () => {
      if (dialog.contains($('toast'))) { hideToast(); document.body.appendChild($('toast')); }
    });
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveWeek(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveWeek(1); }
    else if (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'т') { event.preventDefault(); openItem(); }
  });
  window.addEventListener('hashchange', () => { const key = location.hash.slice(1); if (C.isDateKey(key)) changeDate(key); });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    try { state = readStored(); renderAll(); if ($('item-dialog').open) renderSuggestions(); }
    catch (_) { /* The warning preserves the last known valid in-memory copy. */ }
  });
  function refreshToday() {
    const next = C.todayKey();
    if (next === currentToday) return;
    const followToday = selectedDate === currentToday;
    currentToday = next;
    if (followToday) changeDate(next); else renderAll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  setInterval(refreshToday, 60000);
  renderAll();
})();
