/* A local-first expense calendar. Purchases use integer eurocents; budgets retain fractional cents until display. */
(function () {
  'use strict';
  const C = window.BudgetCore;
  const $ = id => document.getElementById(id);
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const fullWeekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dateLabel = (key, options = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(C.dateOf(key));
  const countLabel = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  // Keep the original key and schema so updating the site preserves existing data.
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
    $('storage-warning').innerHTML = `${escape(message)}${recovery ? ' <button type="button" id="recover-data">Download original data</button>' : ''}`;
    $('save-status').textContent = 'There is a problem saving your data';
    if (recovery) $('recover-data').onclick = () => download(recoveryRaw, `expenses-recovery-${C.todayKey()}.json`, 'application/json');
  }
  function readStored() {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return C.emptyState();
    try { return C.validateState(JSON.parse(raw)); }
    catch (error) {
      recoveryRaw = raw;
      storageWarning('Your local data could not be read and has not been overwritten. Download the original file; you can restore a valid backup in Data.', true);
      throw error;
    }
  }
  try { state = readStored(); }
  catch (error) {
    if (recoveryRaw === null) storageWarning('Your browser is blocking local storage. Allow site storage and reopen this page. No items will be added without being saved.');
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
      $('save-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Saved in this browser';
      renderAll();
      return true;
    } catch (error) {
      if (error.name === 'QuotaExceededError' || error.name === 'SecurityError') {
        storageWarning('Could not save: browser storage is full or blocked. Your existing records have not changed. Download a backup in Data and check your browser settings.');
      }
      showToast(error.message || 'Could not save. Your existing records have not changed.');
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
    const budget = C.weeklyBudget(currentWeek);
    const remain = budget - t.bought;
    const forecast = remain - t.planned;
    $('summary').innerHTML = `
      <div class="metric balance ${remain < 0 ? 'over' : ''}"><p class="metric-label">${remain < 0 ? 'Over budget this week' : 'Left this week'}</p><p class="metric-value" id="week-remaining" data-cents="${remain}">${escape(C.balanceMoney(Math.abs(remain)))}</p><p class="metric-note">Spent ${C.money(t.bought)} of ${C.money(budget)}</p></div>
      <div class="metric spent"><p class="metric-label">Spent this week</p><p class="metric-value" id="week-spent" data-cents="${t.bought}">${C.money(t.bought)}</p><p class="metric-note">${countLabel(t.boughtCount, 'purchase', 'purchases')} · bought items only</p></div>
      <div class="metric forecast"><p class="metric-label">${forecast < 0 ? 'Over budget with plans' : 'Left with plans'}</p><p class="metric-value" id="week-forecast" data-cents="${forecast}">${escape(C.balanceMoney(Math.abs(forecast)))}</p><p class="metric-note">${t.plannedCount ? `${C.money(t.planned)} more planned` : 'No planned purchases yet'}</p></div>`;
    $('week-progress').innerHTML = progressHTML(t.bought, t.planned, budget);
    $('week-progress').setAttribute('role', 'img');
    $('week-progress').setAttribute('aria-label', `Spent ${C.money(t.bought)}, planned ${C.money(t.planned)}, budget ${C.money(budget)}`);
    $('week-budget-label').textContent = `week budget ${C.money(budget)}`;
    $('week-budget-label').title = 'Sum of the seven unrounded daily limits. Each date uses the rate for its own month.';
    renderMonthOverview();
  }
  function renderMonthOverview() {
    const months = [...new Set(C.weekDates(currentWeek).map(C.monthStart))];
    $('month-overview').innerHTML = months.map(date => {
      const n = C.daysInMonth(date);
      const budget = C.monthlyBudget(date);
      const t = C.totals(state.entries, date, C.monthEnd(date));
      const remain = budget - t.bought;
      const forecast = remain - t.planned;
      return `<div class="month-overview-row" data-overview-month="${date.slice(0, 7)}">
        <div class="month-overview-title"><h3>${dateLabel(date, { month: 'long', year: 'numeric' })}</h3><p>€5 × ${n} days + €100</p></div>
        <div class="month-overview-stat"><span>Month budget</span><strong data-month-budget="${budget}">${C.money(budget)}</strong></div>
        <div class="month-overview-stat"><span>Spent</span><strong data-month-spent="${t.bought}">${C.money(t.bought)}</strong></div>
        <div class="month-overview-stat ${remain < 0 ? 'is-over' : ''}"><span>${remain < 0 ? 'Over by' : 'Left this month'}</span><strong data-month-remaining="${remain}">${C.money(Math.abs(remain))}</strong></div>
        <div class="month-overview-stat forecast"><span>${forecast < 0 ? 'Over with plans' : 'Left with plans'}</span><strong data-month-forecast="${forecast}">${C.money(Math.abs(forecast))}</strong></div>
      </div>`;
    }).join('');
  }
  function entryHTML(e) {
    const bought = e.status === 'bought';
    return `<li class="purchase-row ${bought ? '' : 'is-planned'}" data-entry-id="${e.id}">
      <button type="button" class="purchase-toggle" role="checkbox" aria-checked="${bought}" data-toggle-id="${e.id}" aria-label="${escape(e.name)}: ${bought ? 'bought; move to plans' : 'planned; mark as bought'}" title="${bought ? 'Move to plans' : 'Mark as bought'}">${bought ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6 2.2 2.2 4.8-4.8"/></svg>' : ''}</button>
      <button type="button" class="item-edit" data-edit-id="${e.id}" aria-label="Edit: ${escape(e.name)}, ${C.money(e.amountCents)}"><span class="item-name">${escape(e.name)}</span><span class="item-amount">${C.money(e.amountCents)}</span></button>
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
      const budget = C.dailyBudget(date);
      const remaining = budget - t.bought;
      const forecast = remaining - t.planned;
      const today = date === currentToday;
      const month = C.dateOf(date).getUTCDate() === 1 ? `<span class="day-month">${escape(dateLabel(date, { month: 'short' }))}</span>` : '';
      return `<section class="day-card ${today ? 'is-today' : ''} ${date === selectedDate ? 'selected' : ''}" data-date="${date}" aria-label="${fullWeekdays[index]}, ${dateLabel(date)}">
        <div class="day-head"><div><h3 class="day-topline"><span>${weekdays[index]}</span>${today ? '<span class="today-tag">today</span>' : ''}</h3><time datetime="${date}" class="day-number">${C.dateOf(date).getUTCDate()}${month}</time></div><div class="day-head-balance"><span>${remaining < 0 ? 'Over budget this day' : 'Left this day'}</span><strong>${escape(C.balanceMoney(Math.abs(remaining)))}</strong>${t.plannedCount ? `<small>With plans ${escape(C.balanceMoney(forecast))}</small>` : ''}</div><button type="button" class="day-add-icon" data-add-date="${date}" aria-label="Add an item for ${dateLabel(date)}">+</button></div>
        <p class="day-limit" data-day-budget="${budget}" title="${C.money(C.monthlyBudget(date))} ÷ ${C.daysInMonth(date)} days. Rounded only for display.">Daily limit ≈ ${C.money(budget)}</p>
        <ul class="item-list">${items.length ? items.map(entryHTML).join('') : '<li class="day-empty">Nothing yet</li>'}</ul>
        <button type="button" class="inline-add" data-add-date="${date}">+ Add item</button>
        <div class="day-totals"><div class="day-total-row"><span>Spent</span><span>${C.money(t.bought)}</span></div>${t.plannedCount ? `<div class="day-total-row planned-total"><span>Planned</span><span>${C.money(t.planned)}</span></div>` : '<div class="day-total-row total-spacer" aria-hidden="true"><span>Planned</span><span>—</span></div>'}
          <div class="day-total-row day-remaining ${remaining < 0 ? 'is-over' : ''}"><span>${remaining < 0 ? 'Over by' : 'Left'}</span><span data-day-remaining="${remaining}">${escape(C.balanceMoney(Math.abs(remaining)))}</span></div>
          ${t.plannedCount ? `<div class="day-total-row day-forecast" title="${forecast < 0 ? 'You would go over budget with these plans' : 'Balance after all planned purchases'}"><span>With plans</span><span data-day-forecast="${forecast}">${escape(C.balanceMoney(forecast))}</span></div>` : '<div class="day-total-row day-forecast total-spacer" aria-hidden="true"><span>With plans</span><span>—</span></div>'}
          <div class="day-mini-progress" aria-hidden="true">${progressHTML(t.bought, t.planned, budget)}</div>
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
    $('item-dialog-title').textContent = entry ? 'Edit item' : 'Add an item';
    $('item-dialog-kicker').textContent = entry ? 'EDIT ITEM' : 'PURCHASES & PLANS';
    $('item-name').value = entry?.name || catalogItem?.name || '';
    $('item-price').value = entry ? C.inputMoney(entry.amountCents) : catalogItem ? C.inputMoney(catalogItem.priceCents) : '';
    $('item-date').value = entry?.date || date;
    $('item-form').querySelector(`input[name="status"][value="${entry?.status || 'bought'}"]`).checked = true;
    $('save-item').textContent = entry ? 'Save' : 'Add';
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
    $('suggestion-label').textContent = query.trim() ? 'From saved items' : 'From past purchases';
    $('suggestion-count').textContent = results.length ? visible.length < results.length ? `${visible.length} of ${results.length}` : String(results.length) : '';
    $('suggestions').innerHTML = visible.length ? visible.map(c => `<button type="button" class="suggestion" data-catalog-key="${escape(c.key)}"><span>${escape(c.name)}</span><span class="suggestion-price">${C.money(c.priceCents)} <span aria-hidden="true">↗</span></span></button>`).join('') : `<p class="suggestions-empty">${state.catalog.length ? 'New item. It will appear here after you buy it.' : 'Items you buy will appear here automatically.'}</p>`;
  }
  function formStatus() { return $('item-form').querySelector('input[name="status"]:checked').value; }
  function updateFormPreview() {
    const price = C.parseMoney($('item-price').value);
    const date = $('item-date').value;
    if (!C.isDateKey(date)) { $('form-preview').innerHTML = ''; return; }
    const existing = state.entries.filter(e => e.id !== editingId);
    const start = C.weekStart(date);
    const periods = [
      { label: 'Day', total: C.totals(existing, date), budget: C.dailyBudget(date) },
      { label: 'Week', total: C.totals(existing, start, C.addDays(start, 6)), budget: C.weeklyBudget(date) },
      { label: 'Month', total: C.totals(existing, C.monthStart(date), C.monthEnd(date)), budget: C.monthlyBudget(date) }
    ];
    const planned = formStatus() === 'planned';
    const amount = price === null ? 0 : price;
    $('form-preview').classList.toggle('is-planned', planned);
    $('form-preview').innerHTML = `<p class="preview-caption">${planned ? 'After this item and all other plans' : 'After this purchase'}</p><div class="preview-grid">${periods.map(period => {
      const remaining = period.budget - period.total.bought - (planned ? period.total.planned : 0) - amount;
      return `<div class="preview-period" data-preview-period="${period.label.toLowerCase()}" data-preview-remaining="${remaining}"><span>${period.label}</span><strong>${remaining < 0 ? 'Over by' : 'Left'} ${escape(C.balanceMoney(Math.abs(remaining)))}</strong>${!planned && period.total.plannedCount ? `<span class="preview-detail">With plans: ${escape(C.balanceMoney(remaining - period.total.planned))}</span>` : ''}</div>`;
    }).join('')}</div>`;
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
    if (!name || name.length > 120) return formError('Enter an item name between 1 and 120 characters.', 'item-name');
    if (amountCents === null) return formError('Enter a price from €0 to €1,000,000, such as 2.50. Use at most two decimal places.', 'item-price');
    if (!C.isDateKey(date)) return formError('Choose a valid date.', 'item-date');
    const wasEdit = Boolean(editingId);
    const id = editingId || uuid();
    const now = new Date().toISOString();
    const oldDate = selectedDate;
    const success = mutate(draft => {
      const index = draft.entries.findIndex(e => e.id === id);
      if (wasEdit && index === -1) throw new Error('This item was deleted in another tab. Close this window and add it again.');
      if (wasEdit && draft.entries[index].updatedAt !== editingVersion) throw new Error('This item was changed in another tab. Reopen it to avoid losing those changes.');
      const entry = { id, name, amountCents, date, status, createdAt: index === -1 ? now : draft.entries[index].createdAt, updatedAt: now };
      if (index === -1) draft.entries.push(entry); else draft.entries[index] = entry;
      C.recordPurchase(draft, entry);
    });
    if (!success) return formError('The item was not saved. Check the notification for details.');
    if (date !== oldDate) changeDate(date);
    if (event.submitter?.value === 'another' && !wasEdit) {
      editingId = null;
      editingVersion = null;
      $('item-name').value = '';
      $('item-price').value = '';
      renderSuggestions();
      updateFormPreview();
      $('item-name').focus();
      showToast(status === 'planned' ? 'Plan added. Ready for the next one.' : 'Purchase added. Ready for the next one.');
    } else {
      $('item-dialog').close();
      showToast(wasEdit ? 'Changes saved' : status === 'planned' ? 'Added to plans' : 'Purchase added');
    }
  }
  function toggleEntry(id) {
    let nextStatus = '';
    if (mutate(draft => {
      const e = draft.entries.find(e => e.id === id);
      if (!e) throw new Error('This item has already been deleted.');
      nextStatus = e.status === 'bought' ? 'planned' : 'bought';
      e.status = nextStatus;
      e.updatedAt = new Date().toISOString();
      C.recordPurchase(draft, e);
    })) {
      const checkbox = document.querySelector(`[data-toggle-id="${id}"]`);
      checkbox?.focus({ preventScroll: true });
      showToast(nextStatus === 'bought' ? 'Marked as bought' : 'Moved to plans');
    }
  }
  function askConfirmation(title, description, action, button = 'Continue') {
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
    askConfirmation('Delete item?', `“${current.name}” will be removed from the calendar. If you have bought it before, it will remain in your saved items.`, () => {
      let removed;
      if (mutate(draft => {
        const index = draft.entries.findIndex(e => e.id === id);
        if (index === -1) throw new Error('This item has already been deleted.');
        if (draft.entries[index].updatedAt !== version) throw new Error('This item was changed in another tab. Reopen it before deleting.');
        removed = draft.entries.splice(index, 1)[0];
      })) {
        $('item-dialog').close();
        showToast('Item deleted', () => {
          if (mutate(draft => {
            if (!draft.entries.some(e => e.id === removed.id)) draft.entries.push({ ...removed, updatedAt: new Date().toISOString() });
          })) showToast('Item restored');
        });
      }
    }, 'Delete');
  }

  function renderMonth() {
    const key = currentMonth.slice(0, 7);
    $('month-title').textContent = dateLabel(currentMonth, { month: 'long', year: 'numeric' });
    $('prev-month').disabled = !C.isDateKey(C.shiftMonth(currentMonth, -1));
    $('next-month').disabled = !C.isDateKey(C.shiftMonth(currentMonth, 1));
    const weekEnd = C.addDays(currentWeek, 6);
    $('month-grid').innerHTML = C.monthDays(currentMonth).map(date => {
      const t = C.totals(state.entries, date);
      const dailyBudget = C.dailyBudget(date);
      const inMonth = date.slice(0, 7) === key;
      const selected = date === selectedDate;
      return `<button type="button" class="month-day ${inMonth ? '' : 'outside'} ${date === currentToday ? 'is-today' : ''} ${selected ? 'selected' : ''} ${date >= currentWeek && date <= weekEnd ? 'in-week' : ''} ${t.bought > dailyBudget ? 'over-budget' : ''}" data-month-date="${date}" aria-pressed="${selected}" aria-label="${dateLabel(date, { day: 'numeric', month: 'long', year: 'numeric' })}; spent ${C.money(t.bought)}; planned ${C.money(t.planned)}${t.bought > dailyBudget ? `; over by ${escape(C.balanceMoney(t.bought - dailyBudget))}` : ''}" ${C.isDateKey(date) ? '' : 'disabled'}><span class="month-day-number">${C.dateOf(date).getUTCDate()}</span><span class="month-markers" aria-hidden="true">${t.boughtCount ? '<i class="mini-dot"></i>' : ''}${t.plannedCount ? '<i class="mini-dot plan-dot"></i>' : ''}</span></button>`;
    }).join('');
    const t = C.totals(state.entries, currentMonth, C.monthEnd(currentMonth));
    const budget = C.monthlyBudget(currentMonth);
    const remain = budget - t.bought;
    const forecast = remain - t.planned;
    $('month-summary').innerHTML = `<div class="month-formula">€5 × ${C.daysInMonth(currentMonth)} days + €100</div><div><span>Monthly budget</span><span data-calendar-month-budget="${budget}">${C.money(budget)}</span></div><div class="muted"><span>Daily limit</span><span>≈ ${C.money(C.dailyBudget(currentMonth))}</span></div><div><span>Spent this month</span><span>${C.money(t.bought)}</span></div><div class="muted"><span>Planned</span><span>${C.money(t.planned)}</span></div><div class="month-balance"><span>${remain < 0 ? 'Over budget by' : 'Left this month'}</span><span data-calendar-month-remaining="${remain}">${C.money(Math.abs(remain))}</span></div><div class="muted"><span>${forecast < 0 ? 'Over with plans' : 'Left with plans'}</span><span data-calendar-month-forecast="${forecast}">${C.money(Math.abs(forecast))}</span></div>`;
  }
  function openMonth() { currentMonth = C.monthStart(selectedDate); renderMonth(); $('month-dialog').showModal(); }
  function renderLibrary() {
    const matches = C.sortedCatalog(state.catalog, $('library-search').value);
    $('library-count').textContent = `${matches.length} / ${state.catalog.length}`;
    $('library-list').innerHTML = matches.length ? matches.map(c => `<button type="button" class="library-item" data-library-key="${escape(c.key)}"><span><span class="library-item-name">${escape(c.name)}</span><span class="library-item-date">Bought ${escape(dateLabel(c.lastPurchasedDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></span><span class="library-item-price">${C.money(c.priceCents)}</span></button>`).join('') : `<p class="library-empty">${state.catalog.length ? 'No matches.<br>Try another item name.' : 'Nothing here yet.<br>Add your first purchase and it will be saved for next time.'}</p>`;
  }
  function openLibrary() { $('library-search').value = ''; renderLibrary(); $('library-dialog').showModal(); $('library-search').focus(); }
  function renderData() {
    const bought = state.entries.filter(e => e.status === 'bought').length;
    const planned = state.entries.length - bought;
    $('data-stats').innerHTML = `<span><strong>${bought}</strong> bought</span><span><strong>${planned}</strong> planned</span><span><strong>${state.catalog.length}</strong> saved items</span>`;
    $('last-export').textContent = state.lastExportAt ? `Last backup: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.lastExportAt))}` : 'No backup has been created yet.';
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
      download(recoveryRaw, `expenses-recovery-${C.todayKey()}.json`, 'application/json');
      showToast('Original file downloaded. This is not a validated backup.');
      return;
    }
    try { state = readStored(); } catch (_) { /* Keep the in-memory copy available for rescue. */ }
    if (recoveryRaw !== null) return exportData();
    const now = new Date().toISOString();
    const exported = { ...clone(state), exportedAt: now, lastExportAt: now };
    download(JSON.stringify(exported, null, 2), `expenses-${C.todayKey()}-${now.slice(11, 19).replace(/:/g, '')}.json`, 'application/json');
    mutate(draft => { draft.lastExportAt = now; });
    showToast('Backup downloaded');
  }
  async function importFile(file) {
    $('import-error').hidden = true;
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('This file is too large. The limit is 10 MB.');
      const text = (await file.text()).replace(/^\uFEFF/, '');
      let raw;
      try { raw = JSON.parse(text); } catch (_) { throw new Error('Could not read this JSON file. Your current data has not changed.'); }
      const incoming = C.validateState(raw);
      const damaged = recoveryRaw !== null;
      askConfirmation(damaged ? 'Restore data?' : 'Merge this backup?', damaged ? `This backup contains ${incoming.entries.length} records. It will replace unreadable local data. First download the original file using the warning on the main page.` : `This backup contains ${incoming.entries.length} records and ${incoming.catalog.length} saved items. Data will be merged without duplicating matching IDs. Deleted records in an older backup will return.`, () => {
        if (mutate(draft => C.mergeStates(draft, incoming), { replaceDamaged: damaged })) {
          $('data-dialog').close();
          showToast('Backup merged');
        }
      }, damaged ? 'Restore' : 'Merge');
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
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); openItem(); }
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
