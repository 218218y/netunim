import {
  assertAnnual,
  assertRules,
  clone,
  same,
  createAnnual,
  createProfile,
  currentTaxYear,
  israelDate,
  toMinor,
  validDate,
  GROUPS,
} from './contracts.js';
import { defaultRules, ruleWarnings } from './rules.js';
import { calculateTax } from './compute.js';
import { createTaxSync } from './sync.js';
import {
  esc,
  money,
  TABS,
  summaryMarkup,
  inputMarkup,
  rulesMarkup,
  auditMarkup,
  diffMarkup,
  normalizeDate,
  arnonaResultsMarkup,
} from './view.js';

const statusLabels = {
  unloaded: 'טרם נטען',
  loading: 'טוען מהענן',
  local: 'שמור מקומית',
  pending: 'שמור מקומית · ממתין לענן',
  syncing: 'שמור מקומית · מסנכרן',
  synced: 'מסונכרן בענן',
  offline: 'שמור מקומית · הסנכרון לא הושלם',
  conflict: 'נדרשת הכרעה בין גרסאות',
  error: 'נדרש טיפול בשמירה',
};
const set = (target, path, value) => {
  const parts = path.split('.'),
    key = parts.pop();
  let object = target;
  for (const part of parts) {
    if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('שדה אינו תקין');
    object = object[part];
  }
  if (!object || !Object.hasOwn(object, key)) throw new Error('שדה אינו קיים');
  object[key] = value;
};
function readInput(element) {
  const value = element.value,
    type = element.dataset.type;
  if (type === 'boolean') return element.checked;
  if (type === 'date') return normalizeDate(value);
  if (['money', 'percent'].includes(type)) return value === '' ? null : toMinor(value);
  if (type === 'year') {
    if (value === '') return null;
    if (!/^\d{4}$/.test(value)) throw new Error('יש להשלים שנה בארבע ספרות');
    return Number(value);
  }
  if (['integer', 'points'].includes(type)) return value === '' ? null : Number(value);
  return value;
}
export function createTaxWorkspace({
  accountScope,
  request,
  writable,
  active,
  container,
  back,
  confirmDialog,
  subscribeAccountScope = () => () => {},
}) {
  let year = currentTaxYear(),
    tab = 'summary',
    draft = null,
    rulesDraft = null,
    profile = null,
    dirty = false,
    rulesDirty = false,
    message = '',
    loadedScope = null;
  let opening = null,
    localQueue = Promise.resolve(),
    pollTimer = null,
    cloudTimer = null,
    disposed = false,
    historyRows = [],
    preview = null,
    catalog = [],
    rulesCatalog = [],
    reviewName = null;
  const sync = createTaxSync({ accountScope, request, writable, onChange: refreshStatus });
  const pendingInputs = new Map();
  let editRevision = 0;
  const name = () => `year/${year}`;
  function capture(edit = false) {
    const guard = sync.capture(edit),
      observedYear = year;
    return () => {
      guard();
      if (year !== observedYear) throw new Error('שנת המס השתנתה במהלך הפעולה');
    };
  }
  const isCurrent = () => {
    const scope = accountScope();
    return loadedScope && scope.owner === loadedScope.owner && scope.epoch === loadedScope.epoch;
  };
  function refreshStatus() {
    if (!active()) return;
    const root = container();
    if (!root) return;
    for (const node of root.querySelectorAll('[data-tax-status]')) {
      node.textContent = pendingInputs.size ? 'הקלדה בתהליך · ערך חלקי טרם נשמר' : dirty
        ? 'שינויים טרם נשמרו מקומית'
        : sync.state.error || statusLabels[sync.state.status];
      node.title = node.textContent;
    }
  }
  function fail(error) {
    message = error?.message ?? 'הפעולה לא הושלמה';
    if (active()) {
      const notice = container()?.querySelector('[data-tax-message]');
      if (notice) notice.textContent = message;
      else render();
    }
    return false;
  }
  function fieldError(element, text = '') {
    const notice = element.closest?.('label')?.querySelector('[data-tax-field-error]');
    if (notice) { notice.textContent = text; notice.hidden = !text; }
    if (text) element.setAttribute?.('aria-invalid', 'true');
    else element.removeAttribute?.('aria-invalid');
  }
  function stageInput(element, error) {
    const text = element.dataset.type === 'year'
      ? 'יש להשלים שנה בארבע ספרות, בין 2000 ל־2200.'
      : element.dataset.type === 'date' ? 'יש להשלים תאריך תקין בפורמט יום/חודש/שנה.'
        : element.dataset.type === 'money' ? 'יש להשלים סכום תקין, אפס או יותר, עם עד שתי ספרות אחרי הנקודה.'
          : error.message;
    pendingInputs.set(element.dataset.field, { value: element.value, error: text });
    fieldError(element);
    refreshStatus();
    return false;
  }
  function finishInput(element) {
    const pending = pendingInputs.get(element?.dataset?.field);
    if (pending) { fieldError(element, pending.error); refreshStatus(); return false; }
    return commit();
  }
  function editingField() {
    const focused = document.activeElement;
    return container()?.contains(focused) && focused?.matches('input[data-field],select[data-field],textarea[data-field]');
  }
  function result() {
    return draft?.rules ? calculateTax(draft) : null;
  }
  function refreshResult() {
    if (!active() || !isCurrent()) return;
    try {
      const output = result(),
        root = container();
      const live = root.querySelector('[data-tax-live]');
      if (live)
        live.innerHTML = output
          ? `<span>
נטו חודשי משוער</span>
<b>
${output.complete ? money(output.monthly.net) : 'נתונים חסרים'}</b>
`
          : '';
      const arnonaPanel = root.querySelector('[data-tax-arnona-results]');
      if (arnonaPanel && output) arnonaPanel.innerHTML = arnonaResultsMarkup(output);
      for (const field of root.querySelectorAll('[data-tax-auto-field]')) {
        const path = field.dataset.taxAutoField, automatic = draft[path] === null;
        const input = field.querySelector('input');
        const amount = path === 'arnonaBusinessAnnual' ? output?.arnona.businessAnnual : output?.arnona.rentalReceivedMonthly;
        if (automatic && input !== document.activeElement) input.value = amount === null || amount === undefined ? '' : amount / 100;
        const source = field.querySelector('[data-tax-auto-source]');
        if (source) source.textContent = automatic ? 'מחושב אוטומטית · תחזית מנתוני העסק והשכירות' : 'הוזן ידנית · מחליף את החישוב האוטומטי';
        const reset = field.querySelector('[data-action="tax-reset-automatic"]');
        if (reset) reset.hidden = automatic;
      }
      const notice = root.querySelector('[data-tax-message]');
      if (notice) notice.textContent = message;
      refreshStatus();
    } catch (error) {
      const node = container()?.querySelector('[data-tax-message]');
      if (node) node.textContent = error.message;
    }
  }
  async function load() {
    if (disposed) return false;
    if (opening) return opening;
    if (!accountScope().owner) {
      draft = null;
      message = 'יש להתחבר לאותו חשבון ענן בשני האתרים כדי לטעון את המחשבון.';
      render();
      return false;
    }
    const guard = capture(),
      requestedYear = year,
      requestedScope = { ...accountScope() };
    const task = (async () => {
      guard();
      const loadedProfile = await sync.open('profile', createProfile());
      guard();
      profile = loadedProfile;
      // Refresh the permanent profile before creating a year from it. Its
      // account-local cache may have been written by the other application.
      if (writable())
        try {
          await sync.flush();
          guard();
          profile = clone(sync.current('profile'));
        } catch {
          guard();
        }
      const rules = defaultRules(requestedYear);
      const value = await sync.open(
        `year/${requestedYear}`,
        createAnnual(requestedYear, profile, rules),
      );
      guard();
      if (year !== requestedYear) return false;
      draft = clone(value);
      rulesDraft = clone(value.rules ?? rules);
      dirty = false;
      rulesDirty = false;
      pendingInputs.clear();
      loadedScope = { ...accountScope() };
      message = '';
      render();
      const observedEdit = editRevision;
      try {
        const rows = await sync.remote.catalog(accountScope().owner);
        guard();
        catalog = rows;
      } catch {
        guard();
        message = 'רשימת השנים בענן לא נטענה; אפשר לבחור שנה ידנית. העותק המקומי זמין.';
      }
      if (writable())
        try {
          await sync.flush();
          guard();
          if (observedEdit === editRevision && !dirty && !rulesDirty && !pendingInputs.size && !editingField()) {
            draft = clone(sync.current(name()));
            rulesDraft = clone(draft.rules ?? rules);
          }
        } catch {
          guard();
        }
      if (active()) {
        if (observedEdit === editRevision && !pendingInputs.size && !editingField()) render();
        else refreshResult();
      }
      return true;
    })()
      .catch((error) => {
        const live = accountScope();
        if (
          active() &&
          year === requestedYear &&
          live.owner === requestedScope.owner &&
          live.epoch === requestedScope.epoch
        )
          fail(error);
        return false;
      })
      .finally(() => {
        if (opening === task) opening = null;
      });
    opening = task;
    return task;
  }
  function commit() {
    if ([...pendingInputs.keys()].some(path => !path.startsWith('groups.')))
      throw new Error('יש להשלים את השדות שבעריכה לפני שמירה או מעבר מסך.');
    if (!draft || !dirty) return localQueue;
    const value = assertAnnual(clone(draft)),
      doc = name(),
      guard = capture(true);
    guard();
    const task = localQueue.then(async () => {
      guard();
      await sync.save(doc, value);
      guard();
      if (doc === name() && same(draft, value)) dirty = false;
      refreshStatus();
      return true;
    });
    localQueue = task.catch((error) => {
      if (isCurrent()) fail(error);
    });
    task
      .then(() => {
        if (disposed || !writable()) return;
        const networkGuard = sync.capture(true);
        clearTimeout(cloudTimer);
        cloudTimer = setTimeout(() => {
          cloudTimer = null;
          try {
            networkGuard();
            void sync.flush().catch(() => refreshStatus());
          } catch {}
        }, 700);
      })
      .catch(() => refreshStatus());
    return task;
  }
  function recoveryMarkup() {
    const conflicts = [...sync.state.conflicts];
    return `<h2>
גיבוי ושחזור למחשבון בלבד</h2>
<p>
ייצוא מכיל נתונים כספיים ותאריכי לידה. יש לשמור אותו במקום פרטי. שחזור משפיע על השנה שנבחרה בלבד; כללי עבר נשארים שמורים.</p>
<div
class="tax-toolbar">
<button
class="btn"
data-action="tax-export">
ייצוא JSON של השנה</button>
<label
class="btn">
תצוגה מקדימה לייבוא <input
type="file"
accept=".json,application/json"
data-change="tax-import">
</label>
<button
class="btn"
data-action="tax-history">
טען היסטוריית שנה</button>
<button
class="btn"
data-action="tax-profile-history">
טען היסטוריית פרופיל קבוע</button>
</div>
${conflicts
  .map(
    ([doc, c]) => `<section
class="tax-warning">
<h3>
התנגשות: ${esc(doc)}</h3>
${diffMarkup(c.remote?.state ?? {}, c.local)}<button
class="btn"
data-action="tax-resolve-remote"
data-name="${esc(doc)}">
השתמש בגרסת הענן</button>
<button
class="btn"
data-action="tax-resolve-local"
data-name="${esc(doc)}">
אשר את העותק המקומי מול הגרסה המוצגת</button>
</section>
`,
  )
  .join('')}<div>
${historyRows
  .map(
    (h, index) => `<button
class="btn"
data-action="tax-preview-history"
data-index="${index}">
גרסה ${h.revision} · ${esc(h.createdAt ?? '')}</button>
`,
  )
  .join('')}</div>
${
  preview
    ? `<section>
<h3>
השוואה לפני ${preview.kind === 'import' ? 'ייבוא' : 'שחזור'}</h3>
${diffMarkup(preview.name === 'profile' ? profile : draft, preview.state)}<button
class="btn primary"
data-action="tax-accept-preview">
אשר ${preview.kind === 'import' ? 'ייבוא' : 'שחזור'} למסמך המוצג</button>
<button
class="btn"
data-action="tax-cancel-preview">
ביטול</button>
</section>
`
    : ''
}`;
  }
  function render() {
    if (!active() || disposed) return;
    const root = container();
    if (!root) return;
    if (draft && !isCurrent()) {
      draft = null;
      profile = null;
      rulesDraft = null;
      dirty = false;
      rulesDirty = false;
    }
    const output = draft ? result() : null,
      ruleAlerts = draft?.rules ? ruleWarnings(draft.rules, year) : [];
    root.innerHTML = `<section
class="tax-page"
dir="rtl">
<header
class="tax-hero">
<div>
<button
class="tax-back"
data-action="tax-back">
← חזרה למסך הקודם</button>
<h1>
מחשבון מסים וארנונה</h1>
</div>
<div
data-tax-live
class="tax-live">
${
  output
    ? `<span>
נטו חודשי משוער</span>
<b>
${output.complete ? money(output.monthly.net) : 'נתונים חסרים'}</b>
`
    : ''
}</div>
</header>
<div
class="tax-toolbar">
<label>
שנת מס <input
id="tax-year"
type="number"
min="2000"
max="2200"
value="${year}"
data-change="tax-year"
list="tax-years">
<datalist
id="tax-years">
${[
  ...new Set([
    2025,
    2026,
    2027,
    currentTaxYear(),
    ...catalog
      .filter((r) => r.document_name.startsWith('year/'))
      .map((r) => Number(r.document_name.slice(5))),
  ]),
]
  .sort()
  .map(
    (y) => `<option
value="${y}">
`,
  )
  .join('')}</datalist>
</label>
${
  draft
    ? `<label>
סוג נתונים <select
data-field="mode"
data-type="text"
data-input="tax-input"
data-change="tax-save">
<option
value="forecast"
${draft.mode === 'forecast' ? 'selected' : ''}>
תחזית</option>
<option
value="actual"
${draft.mode === 'actual' ? 'selected' : ''}>
נתוני שנה בפועל</option>
</select>
</label>
<label>
מקור <select
data-field="source"
data-type="text"
data-input="tax-input"
data-change="tax-save">
<option
value="manual"
${draft.source === 'manual' ? 'selected' : ''}>
הוזן ידנית</option>
<option
value="assessment"
${draft.source === 'assessment' ? 'selected' : ''}>
אומת מול שומה לפי המשתמש</option>
</select>
</label>
`
    : ''
}<span
class="tax-status"
data-tax-status
role="status">
${dirty ? 'טרם נשמר' : esc(sync.state.error || statusLabels[sync.state.status])}</span>
<button
class="btn"
data-action="tax-sync">
שמור ובדוק ענן</button>
</div>
<p
class="tax-message"
data-tax-message
role="alert">${esc(message)}</p>
${
  ruleAlerts.length
    ? `<div
class="tax-warning">
<b>
${ruleAlerts.length} קבוצות כללים לשנת ${year} דורשות בדיקה</b>
<span>
התוצאה היא אומדן עד להשלמת בדיקת כללי השנה. <button
class="tax-link"
data-action="tax-rules">
פתח עדכון שנתי</button>
</span>
</div>
`
    : ''
}${sync.state.conflicts.size ? '<div class="tax-warning">נמצאה התנגשות. <button class="btn" data-action="tax-recovery">פתח השוואה ופתרון</button></div>' : ''}${
      draft
        ? `<nav
class="tax-tabs"
aria-label="פרקי המחשבון">
${TABS.map(
  ([key, label]) => `<button
aria-current="${tab === key ? 'page' : 'false'}"
class="${tab === key ? 'active' : ''}"
data-action="tax-tab"
data-tab="${key}">
${label}</button>
`,
).join('')}</nav>
<div
class="tax-panel">
<fieldset
class="tax-edit"
${!writable() ? 'disabled' : ''}>
${tab === 'summary' ? summaryMarkup(output) : tab === 'rules' ? rulesMarkup(rulesDraft) : tab === 'audit' ? auditMarkup(output) : tab === 'recovery' ? recoveryMarkup() : inputMarkup(tab, draft, output)}</fieldset>
</div>
${!['summary', 'audit', 'rules', 'recovery'].includes(tab) ? '<div class="tax-toolbar"><button class="btn primary" data-action="tax-save">שמור נתוני שנה</button><span>ערכים תקינים נשמרים מקומית במהלך ההקלדה.</span></div>' : ''}<footer>
נתוני המחשבון נפרדים מהמאזן התזרימי. חישובי המס וההנחה הם אומדן; אישור הרשות והנתונים מהשומה קובעים.</footer>
`
        : `<div
class="tax-panel">
<p>
${esc(message || 'טוען את נתוני המחשבון…')}</p>
<button
class="btn"
data-action="tax-retry">
נסה לטעון</button>
</div>
`
    }</section>
`;
    refreshStatus();
    for (const element of root.querySelectorAll('[data-field]')) {
      const pending = pendingInputs.get(element.dataset.field);
      if (pending) element.value = pending.value;
    }
  }
  async function refresh() {
    if (!active() || disposed) return;
    if (!isCurrent()) return load();
    if (dirty || rulesDirty || pendingInputs.size || editingField() || !writable()) return;
    const observedEdit = editRevision;
    try {
      await localQueue;
      await sync.flush();
      if (!isCurrent() || dirty || rulesDirty || pendingInputs.size || editingField() || observedEdit !== editRevision) return;
      profile = clone(sync.current('profile'));
      const value = sync.current(name());
      if (value && !same(value, draft)) {
        draft = clone(value);
        rulesDraft = clone(value.rules ?? defaultRules(year));
        render();
      } else refreshStatus();
    } catch {
      refreshStatus();
    }
  }
  async function changeTab(next) {
    if (!TABS.some(([key]) => key === next)) return;
    await commit();
    tab = next;
    preview = null;
    render();
  }
  const commands = {
    'tax-input': (element) => {
      if (!isCurrent() || !writable()) throw new Error('יש לטעון את המחשבון בלשונית הראשית');
      editRevision++;
      const next = clone(draft);
      try {
        set(next, element.dataset.field, readInput(element));
        assertAnnual(next);
      } catch (error) { return stageInput(element, error); }
      pendingInputs.delete(element.dataset.field);
      fieldError(element);
      draft = next;
      dirty = true;
      message = '';
      refreshResult();
      if ([...pendingInputs.keys()].some(path => !path.startsWith('groups.'))) { refreshStatus(); return false; }
      return commit();
    },
    'tax-save': (element) => finishInput(element),
    'tax-reset-automatic': async (element) => {
      if (!isCurrent() || !writable()) throw new Error('אין הרשאת עריכה');
      const path = element.dataset.field;
      if (!['arnonaBusinessAnnual', 'arnonaRentReceivedMonthly'].includes(path)) throw new Error('שדה אוטומטי אינו תקין');
      pendingInputs.delete(path);
      draft[path] = null;
      dirty = true;
      editRevision++;
      const input = container()?.querySelector(`input[data-field="${path}"]`);
      if (input) {
        fieldError(input);
        const output = result();
        const amount = path === 'arnonaBusinessAnnual' ? output.arnona.businessAnnual : output.arnona.rentalReceivedMonthly;
        input.value = amount === null ? '' : amount / 100;
      }
      refreshResult();
      return commit();
    },
    'tax-rule-input': (element) => {
      if (!isCurrent() || !writable()) throw new Error('אין הרשאת עריכה');
      editRevision++;
      rulesDirty = true;
      const path = element.dataset.field;
      const next = clone(rulesDraft);
      const key = path.split('.')[1];
      try {
        set(next, path, readInput(element));
        if (next.groups[key]) {
          next.groups[key].status = 'draft';
          next.groups[key].checkedAt = null;
          next.groups[key].checkedBy = null;
        }
        assertRules(next);
      } catch (error) { return stageInput(element, error); }
      pendingInputs.delete(path);
      fieldError(element);
      rulesDraft = next;
      refreshStatus();
    },
    'tax-rule-change': (element) => {
      const pending = pendingInputs.get(element.dataset.field);
      if (pending) fieldError(element, pending.error);
    },
    'tax-back': async () => {
      await commit();
      if (
        rulesDirty &&
        !(await confirmDialog('כללים שלא פורסמו', 'לצאת מהמחשבון? שינויי הכללים לא פורסמו.'))
      )
        return;
      back();
    },
    'tax-tab': (element) => changeTab(element.dataset.tab),
    'tax-audit': (_, event) => {
      event?.preventDefault();
      return changeTab('audit');
    },
    'tax-rules': () => changeTab('rules'),
    'tax-recovery': () => changeTab('recovery'),
    'tax-year': async (element) => {
      const next = Number(element.value);
      if (!Number.isInteger(next) || next < 2000 || next > 2200)
        throw new Error('בחר שנת מס בין 2000 ל־2200');
      const guard = capture();
      await commit();
      guard();
      if (
        rulesDirty &&
        !(await confirmDialog('כללים שלא פורסמו', 'לעבור שנה בלי לפרסם את שינויי הכללים?'))
      )
        return;
      guard();
      year = next;
      opening = null;
      draft = null;
      rulesDraft = null;
      loadedScope = null;
      historyRows = [];
      preview = null;
      render();
      return load();
    },
    'tax-retry': () => load(),
    'tax-sync': async () => {
      await commit();
      await sync.flush();
      message = '';
      refreshResult();
      return refresh();
    },
    'tax-add-child': async () => {
      const value = normalizeDate(container().querySelector('#tax-new-child')?.value);
      if (!validDate(value)) throw new Error('יש לבחור תאריך לידה תקין');
      draft.profile.children.push({ id: crypto.randomUUID(), birthDate: value, resident: true });
      dirty = true;
      await commit();
      render();
    },
    'tax-remove-child': async (element) => {
      draft.profile.children.splice(Number(element.dataset.index), 1);
      dirty = true;
      await commit();
      render();
    },
    'tax-save-profile': async () => {
      const guard = capture(true);
      await commit();
      guard();
      if (
        !(await confirmDialog(
          'שמירת פרופיל קבוע',
          'לשמור את פרטי המשפחה המוצגים לשימוש ביצירת שנים חדשות? שנים קיימות לא ישתנו.',
        ))
      )
        return;
      guard();
      await sync.save('profile', draft.profile);
      guard();
      profile = clone(draft.profile);
      message = 'הפרופיל הקבוע נשמר מקומית';
      render();
      return sync.flush();
    },
    'tax-apply-profile': async () => {
      const guard = capture(true);
      if (!(await confirmDialog('פרטי השנה', 'להחליף את פרטי המשפחה של השנה בפרופיל הקבוע?')))
        return;
      guard();
      draft.profile = clone(profile);
      dirty = true;
      await commit();
      render();
    },
    'tax-review-group': async (element) => {
      const guard = capture(true),
        key = element.dataset.group;
      if (!GROUPS.includes(key)) return;
      if ([...pendingInputs.keys()].some(path => path.startsWith('groups.' + key + '.')))
        throw new Error('יש להשלים את שדות הקבוצה לפני סימון בדיקה');
      if (
        !(await confirmDialog(
          'סימון בדיקה',
          'בדקת את המקור, הערכים ותאריכי התחולה של קבוצה זו לשנה ' +
            year +
            '? הסימון הוא בדיקה שלך, ולא אימות משפטי.',
        ))
      )
        return;
      guard();
      const group = rulesDraft.groups[key];
      group.year = year;
      group.status = 'reviewed';
      group.checkedAt = israelDate();
      group.checkedBy = accountScope().owner;
      rulesDirty = true;
      assertRules(rulesDraft);
      render();
    },
    'tax-publish-rules': async () => {
      const guard = capture(true);
      if (pendingInputs.size) throw new Error('יש להשלים את השדות שבעריכה לפני פרסום כללים');
      assertRules(rulesDraft);
      if (
        !(await confirmDialog(
          'פרסום גרסת כללים',
          'ליצור גרסה חדשה ולהחיל אותה על השנה הנוכחית? התוצאות לשנה זו יחושבו מחדש.',
        ))
      )
        return;
      guard();
      await commit();
      guard();
      const next = clone(rulesDraft);
      next.taxYear = year;
      next.version = `${year}.${crypto.randomUUID()}`;
      const doc = `rules/${year}/${next.version}`;
      await sync.open(doc, next);
      guard();
      await sync.save(doc, next);
      guard();
      draft.rules = next;
      dirty = true;
      await commit();
      guard();
      rulesDraft = clone(next);
      rulesDirty = false;
      render();
      return sync.flush();
    },
    'tax-rule-versions': async () => {
      const guard = capture();
      const rows = await sync.remote.catalog(accountScope().owner);
      guard();
      rulesCatalog = rows.filter((row) => row.document_name.startsWith(`rules/${year}/`));
      message = 'גרסאות כללים זמינות מוצגות להלן';
      render();
      const panel = container().querySelector('.tax-panel');
      panel.insertAdjacentHTML(
        'beforeend',
        `<div
class="tax-toolbar">
${
  rulesCatalog
    .map(
      (r, index) => `<button
class="btn"
data-action="tax-use-rules"
data-index="${index}">
${esc(r.document_name.split('/')[2])}</button>
`,
    )
    .join('') || 'אין גרסאות נוספות בענן'
}</div>
`,
      );
    },
    'tax-use-rules': async (element) => {
      const guard = capture(true),
        doc = rulesCatalog[Number(element.dataset.index)]?.document_name;
      if (!doc) return;
      const row = await sync.remote.read(accountScope().owner, doc);
      guard();
      if (!row) throw new Error('גרסת הכללים אינה זמינה');
      if (!(await confirmDialog('החלפת כללים', 'להחיל את הגרסה שנבחרה ולחשב מחדש את השנה?')))
        return;
      guard();
      draft.rules = assertRules(row.state);
      dirty = true;
      await commit();
      rulesDraft = clone(draft.rules);
      rulesDirty = false;
      render();
    },
    'tax-export': async () => {
      const guard = capture();
      await commit();
      guard();
      const blob = new Blob(
          [
            JSON.stringify(
              {
                format: 'netunim-tax-calculator',
                schema: 1,
                exportedAt: new Date().toISOString(),
                annual: draft,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
        url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `netunim-tax-${year}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    'tax-import': async (element) => {
      const guard = capture(true),
        file = element.files?.[0];
      if (!file) return;
      if (file.size > 2097152) throw new Error('קובץ המחשבון גדול מדי');
      const payload = JSON.parse(await file.text());
      guard();
      if (payload.format !== 'netunim-tax-calculator' || payload.schema !== 1)
        throw new Error('בחר קובץ מחשבון שיוצא מהמערכת');
      const value = assertAnnual(payload.annual);
      if (value.taxYear !== year) throw new Error('בחר תחילה את שנת המס ' + value.taxYear);
      preview = { kind: 'import', name: name(), state: value, revision: null };
      render();
    },
    'tax-history': async () => {
      const guard = capture();
      reviewName = name();
      const rows = await sync.remote.history(accountScope().owner, reviewName);
      guard();
      historyRows = rows;
      preview = null;
      render();
    },
    'tax-profile-history': async () => {
      const guard = capture();
      reviewName = 'profile';
      const rows = await sync.remote.history(accountScope().owner, 'profile');
      guard();
      historyRows = rows;
      preview = null;
      render();
    },
    'tax-preview-history': (element) => {
      const row = historyRows[Number(element.dataset.index)];
      if (!row) return;
      preview = {
        kind: 'restore',
        name: reviewName,
        state: clone(row.state),
        revision: row.revision,
      };
      render();
    },
    'tax-cancel-preview': () => {
      preview = null;
      render();
    },
    'tax-accept-preview': async () => {
      const guard = capture(true),
        selected = clone(preview);
      if (!selected) return;
      if (
        !(await confirmDialog(
          'אישור שינוי',
          'להחיל את השינויים שהוצגו בהשוואה? הגרסה הנוכחית תישמר בהיסטוריה לאחר סנכרון.',
        ))
      )
        return;
      guard();
      await commit();
      guard();
      await sync.save(selected.name, selected.state, { restoreRevision: selected.revision });
      guard();
      if (selected.name === 'profile') profile = clone(selected.state);
      else {
        draft = clone(selected.state);
        rulesDraft = clone(draft.rules ?? defaultRules(year));
        dirty = false;
      }
      preview = null;
      render();
      return sync.flush();
    },
    'tax-resolve-remote': (element) => resolve(element.dataset.name, 'remote'),
    'tax-resolve-local': (element) => resolve(element.dataset.name, 'local'),
  };
  async function resolve(doc, choice) {
    const guard = capture(true);
    if (
      !(await confirmDialog(
        'פתרון התנגשות',
        choice === 'remote'
          ? 'לטעון את גרסת הענן? העותק המקומי יוחלף. ניתן לייצא אותו לפני פעולה זו.'
          : 'לפרסם את העותק המקומי מול גרסת הענן שהוצגה בהשוואה?',
      ))
    )
      return;
    guard();
    const value = await sync.resolve(doc, choice);
    guard();
    if (doc === name()) {
      draft = clone(value);
      rulesDraft = clone(draft.rules ?? defaultRules(year));
      dirty = false;
    }
    if (doc === 'profile') profile = clone(value);
    render();
    return sync.flush();
  }
  const onFocus = () => {
    if (active()) return refresh();
  };
  const onOnline = () => {
    if (active()) return refresh();
  };
  const onUnload = (event) => {
    if (dirty || rulesDirty || pendingInputs.size) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  const unsubscribe = subscribeAccountScope(() => {
    clearTimeout(cloudTimer);
    cloudTimer = null;
    pendingInputs.clear();
    sync.reset();
    draft = null;
    rulesDraft = null;
    profile = null;
    loadedScope = null;
    historyRows = [];
    catalog = [];
    rulesCatalog = [];
    preview = null;
    opening = null;
    dirty = false;
    rulesDirty = false;
    message = 'חשבון הענן השתנה';
    if (active()) {
      render();
      void load();
    }
  });
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', onUnload);
  pollTimer = setInterval(() => {
    if (active() && !document.hidden) void refresh();
  }, 20000);
  return {
    render,
    activate: () => {
      if (!active() || disposed) return Promise.resolve(false);
      render();
      return draft && isCurrent() ? refresh() : load();
    },
    async command(key, element, event) {
      if (disposed) return false;
      const observed = { ...accountScope() },
        commandYear = year;
      try {
        const action = commands[key];
        if (!action) throw new Error('פעולת מחשבון אינה קיימת');
        return await action(element, event);
      } catch (error) {
        const live = accountScope();
        return observed.owner === live.owner &&
          observed.epoch === live.epoch &&
          commandYear === year
          ? fail(error)
          : false;
      }
    },
    async dispose() {
      disposed = true;
      clearInterval(pollTimer);
      clearTimeout(cloudTimer);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onUnload);
      if (opening) await opening;
      await localQueue;
      await sync.drain();
      await sync.dispose();
    },
  };
}
