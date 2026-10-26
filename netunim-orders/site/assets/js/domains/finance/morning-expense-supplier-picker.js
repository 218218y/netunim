import {esc} from '../../core/values.js';
import {searchMatch} from '../../core/search.js';

export function createExpenseSupplierPicker({rows, selectedId, eligibility, editable, choose, invalidateSelection, search, commit, run, report}) {
  let query = null, activeId = '', revision = 0, timer = null, controller = null, page = null, busy = false;
  const host = () => document.querySelector('[data-expense-supplier-picker]');
  const input = () => host()?.querySelector('[role="combobox"]');
  const visible = () => rows().filter(row => searchMatch(query || '', [row.name, row.taxId]));
  const selectable = () => visible().filter(row => {const check = eligibility(row); return check.eligible || check.p;});
  function cancel() {revision++; clearTimeout(timer); timer = null; controller?.abort(); controller = null; busy = false;}
  function reset() {cancel(); query = null; activeId = ''; page = null;}
  function options() {
    const found = visible(), choices = selectable();
    if (!choices.some(row => row.id === activeId)) activeId = choices.length === 1 ? choices[0].id : '';
    return found.map(row => {
      const check = eligibility(row), disabled = !check.eligible && !check.p;
      return `<button type="button" role="option" id="expense-supplier-${esc(row.id)}" aria-selected="${row.id === selectedId()}"
        class="morning-expense-supplier-option${row.id === activeId ? ' keyboard-active' : ''}" ${disabled ? 'disabled' : ''}
        data-action="morning-expense-field" data-expense-picker="choose" data-expense-supplier="${esc(row.id)}">
        <b>${esc(row.name)}</b><small>${esc(row.taxId || 'ללא מספר עוסק')}${check.reason ? ' · ' + esc(check.reason) : ''}</small></button>`;
    }).join('') || '<p>לא נמצאו ספקים מתאימים.</p>';
  }
  function status() {return busy ? 'מחפש ב־Morning…' : page ? `נמצאו ${page.total} ספקים · עמוד ${page.page + 1}` : 'אפשר להקליד שם או מספר עוסק ולבחור בחצים וב־Enter.';}
  function panel() {
    return `<div role="listbox" id="morningExpenseSupplierOptions" aria-label="ספקי Morning">${options()}</div>
      <small role="status" data-supplier-search-status>${esc(status())}</small>
      ${page?.pages > 1 ? `<div class="morning-expense-toolbar">
      <button type="button" class="btn" data-action="morning-expense-field" data-expense-picker="page" data-expense-step="-1" ${busy || page.page === 0 ? 'disabled' : ''}>קודם</button>
      <button type="button" class="btn" data-action="morning-expense-field" data-expense-picker="page" data-expense-step="1" ${busy || page.page + 1 >= page.pages || page.page >= 999 ? 'disabled' : ''}>הבא</button></div>` : ''}`;
  }
  function refresh() {
    const popup = host()?.querySelector('[data-menu-panel]'); if (!popup) return;
    popup.innerHTML = panel();
    const field = input();
    if (activeId) field?.setAttribute('aria-activedescendant', 'expense-supplier-' + activeId);
    else field?.removeAttribute('aria-activedescendant');
  }
  function open() {
    if (!editable()) return false;
    const field = input(); if (!field) return false;
    if (!host().classList.contains('open')) {
      query = ''; field.value = rows().find(row => row.id === selectedId())?.name || ''; field.select(); activeId = ''; refresh();
    }
    host().classList.add('open'); field.setAttribute('aria-expanded', 'true'); return true;
  }
  function remote(targetPage = 0) {
    cancel(); const epoch = revision, term = query || '';
    if (!editable()) return false;
    controller = new AbortController(); const signal = controller.signal; busy = true; refresh();
    return run(async () => {
      try {
        const value = await search(term, targetPage, signal);
        if (epoch !== revision || !editable()) return false;
        commit(value); page = value; activeId = '';
      } catch (error) {
        if (epoch === revision && editable() && error.name !== 'AbortError') report('לא ניתן להשלים חיפוש ספקים כעת. אפשר לנסות שוב.');
      } finally {if (epoch === revision) {busy = false; controller = null; refresh();}}
    });
  }
  function filter(element, event) {
    if (!editable()) return false;
    cancel(); query = element.value; activeId = ''; page = null; invalidateSelection();
    host()?.classList.add('open'); element.setAttribute('aria-expanded', 'true'); refresh();
    // Always search the directory as well: the initial list is intentionally paged.
    if (!event?.isComposing) timer = setTimeout(() => remote(), 300);
    return true;
  }
  async function pick(id) {
    if (!editable() || !selectable().some(row => row.id === id)) return false;
    reset(); const result = await choose(id);
    document.querySelector('[data-expense-field="number"]')?.focus(); return result;
  }
  function keyboard(element, event) {
    if (event.isComposing || !editable()) return false;
    if (event.key === 'Escape') {host()?.classList.remove('open'); element.setAttribute('aria-expanded', 'false'); return true;}
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key !== 'Enter') open();
    const choices = selectable();
    if (event.key === 'Enter') {
      const choice = choices.find(row => row.id === activeId) || (choices.length === 1 ? choices[0] : null);
      if (choice) {event.preventDefault(); return pick(choice.id);}
      return false;
    }
    if (!choices.length) return false;
    event.preventDefault(); const current = choices.findIndex(row => row.id === activeId), step = event.key === 'ArrowDown' ? 1 : -1;
    activeId = choices[(current < 0 ? (step === 1 ? 0 : choices.length - 1) : (current + step + choices.length) % choices.length)].id;
    refresh(); document.getElementById('expense-supplier-' + activeId)?.scrollIntoView({block:'nearest'}); return true;
  }
  function markup(disabled) {
    const selected = rows().find(row => row.id === selectedId());
    return `<label for="morningExpenseSupplier">ספק ב־Morning</label>
      <div class="morning-expense-supplier" data-expense-supplier-picker data-floating-menu>
      <input id="morningExpenseSupplier" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="morningExpenseSupplierOptions" autocomplete="off" spellcheck="false" maxlength="180"
        placeholder="בחר ספק או הקלד לחיפוש…" value="${esc(query ?? selected?.name ?? '')}" ${disabled ? 'disabled' : ''}
        data-menu-trigger data-expense-field="supplierQuery" data-expense-picker="input" data-action="morning-expense-field"
        data-focus="morning-expense-field" data-input="morning-expense-field" data-keydown="morning-expense-field">
      <div class="morning-expense-supplier-panel" data-menu-panel>${panel()}</div></div>
      <input type="hidden" data-expense-field="supplierId" data-change="morning-expense-field" value="${esc(selectedId())}">`;
  }
  function handle(element, event) {
    if (element.dataset.expensePicker === 'choose') return pick(element.dataset.expenseSupplier);
    if (element.dataset.expensePicker === 'page') return remote((page?.page || 0) + Number(element.dataset.expenseStep));
    if (event?.type === 'keydown') return keyboard(element, event);
    return event?.type === 'input' ? filter(element, event) : open();
  }
  return {markup, reset, handle};
}
