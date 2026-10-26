import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeExpenseInput} from '../../core/morning-expense-input.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {readExpenseCatalog} from './morning-expense-catalog.js';

const stateLabels = {reserved:'ממתינה לבדיקה', pending:'נשלחה · טרם אומתה', created_unverified:'נוצרה · אימות הפרטים ממתין', created:'נוצרה והפרטים אומתו', needs_reconciliation:'תוצאה לא ברורה · נדרש בירור ב־Morning', blocked:'הפעולה נחסמה · נדרש בירור'};
const fieldLabels = {number:'מספר חשבונית', date:'תאריך המסמך', net:'לפני מע״מ', vat:'מע״מ מהחשבונית', gross:'כולל מע״מ', description:'תיאור', allocationNumber:'מספר הקצאה, אם נדרש'};
export function createMorningExpenseIntake({request, captureRead, captureWrite, accountId, subscribeAccountScope, confirmDialog, files, isActive = () => true}) {
  const tasks = createRuntimeTaskOwner();
  let expanded = false, catalog = null, busy = false, generation = 0, reading = null, message = '', result = null, operationId = '', fileAttempted = false;
  let queue = [], selected = null, previewUrl = '', draft = defaults();
  function defaults(previous = {}) {
    const today = checkTodayISO();
    return {supplierId:previous.supplierId || '', classificationExpenseId:previous.classificationExpenseId || '', documentType:305, number:'',
      date:today, reportingDate:today.slice(0, 7) + '-01', net:'', vat:'', gross:'', description:'', allocationNumber:'', pcnClassification:'T'};
  }
  const host = () => document.querySelector('[data-morning-expense-intake]');
  const active = () => tasks.isActive() && isActive();
  function capture(write = false) {
    const check = write ? captureWrite() : captureRead(), epoch = generation;
    return () => { check(); if (!active() || generation !== epoch) throw new Error('פעולת ההוצאות שייכת למסך או להתחברות קודמים.'); };
  }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  function key() { const owner = accountId(); if (!owner) throw new Error('נדרשת התחברות לענן.'); return 'morningExpenseOperation:' + owner; }
  function remember() {
    // Persist before POST; a failure to persist blocks submission. No invoice data or file bytes are retained.
    localStorage.setItem(key(), JSON.stringify({version:1, operationId, environment:catalog.capabilities.environment}));
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(key()) || 'null');
      if (saved?.version === 1 && /^[\da-f-]{36}$/i.test(saved.operationId) && saved.environment === catalog.capabilities.environment) {
        operationId = saved.operationId; result = {state:'needs_reconciliation', verified:false}; message = 'נמצאה פעולה קודמת. יש לבדוק את מצבה לפני קליטה נוספת.';
      }
    } catch { /* No prior recovery metadata. */ }
  }
  function clear() {
    reading?.abort(); reading = null; generation++; catalog = null; busy = false; message = ''; result = null; operationId = ''; fileAttempted = false;
    queue = []; selected = null; releasePreview(); draft = defaults();
  }
  const unsubscribe = subscribeAccountScope(() => { clear(); render(); });
  function render() {
    if (!active()) return;
    const target = host(); if (!target) return;
    target.outerHTML = markup();
    host()?.addEventListener('paste', event => {
      if (event.clipboardData?.files.length) { event.preventDefault(); void chooseFiles(event.clipboardData.files); }
    });
  }
  function updateMessage(value) { message = value; const output = host()?.querySelector('[data-expense-message]'); if (output) output.textContent = value; }
  function run(work) {
    if (busy || !active()) return false;
    const epoch = generation; busy = true; render();
    return tasks.run(async () => {
      try { return await work(); }
      catch (error) { if (generation === epoch && active()) message = ({invalid_expense_input:'יש לבחור ספק וסיווג ולבדוק מספר חשבונית ותאריכים.', invalid_expense_amounts:'סכומי הנטו והמע״מ חייבים להתאים לסכום הכולל, בדיוק של אגורות.', morning_expense_p_unverified:'חשבוניות P ייקלטו ב־Morning עד לאימות המסלול.'})[error.message] || error.message || 'הפעולה לא הושלמה.'; return false; }
      finally { if (generation === epoch && active()) { busy = false; render(); } }
    });
  }
  function load() {
    return run(async () => {
      const check = capture(), controller = new AbortController(); reading = controller;
      const loaded = await readExpenseCatalog(request, check, checkTodayISO(), {signal:controller.signal}); check();
      catalog = loaded; reading = null; message = 'הספקים והסיווגים מההוצאות הקיימות עודכנו.';
      if (!operationId) restore();
    });
  }
  function setField(element) {
    if (busy || operationId) return false;
    const name = element.dataset.expenseField;
    if (!Object.hasOwn(draft, name)) return false;
    draft[name] = name === 'documentType' ? Number(element.value) : name === 'reportingDate' ? element.value + '-01' : element.value;
    if (name === 'supplierId') {
      const history = catalog?.expenses.filter(row => row.supplierId === draft.supplierId && row.status !== 100).sort((a, b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)));
      const recent = history?.find(row => row.classification?.id);
      draft.classificationExpenseId = recent?.id || '';
      const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
      draft.pcnClassification = history?.some(row => row.pcnClassification === 'P') || catalog?.capabilities.pSuppliers?.some(profile => profile.id === supplier?.id || profile.taxId && profile.taxId === supplier?.taxId) ? 'P' : 'T';
      render();
    } else if (name === 'pcnClassification') render();
    else updateMessage('הפרטים טרם נשמרו. יש לבדוק מול מסמך המקור.');
    return true;
  }
  async function chooseFiles(selection) {
    if (busy || operationId && !result?.verified || fileAttempted) return false;
    return run(async () => {
      const check = capture(), list = Array.from(selection);
      if (!list.length || list.length > 20 || list.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error('ניתן לבחור עד 20 קבצים ובסך הכול עד 100MB.');
      const validated = [];
      for (const file of list) { validated.push(await files.validate(file)); check(); }
      queue = validated; selectNextFile(); message = 'הקובץ מוצג לבדיקה. נתונים לא פוענחו אוטומטית.';
    });
  }
  function selectNextFile() {
    releasePreview(); selected = queue.shift() || null;
    if (selected) previewUrl = URL.createObjectURL(selected.file);
  }
  function save() {
    return run(async () => {
      const check = capture(true);
      if (!catalog?.capabilities.create || operationId) throw new Error('שמירה אינה זמינה לפעולה זו.');
      const nextId = crypto.randomUUID(), snapshot = structuredClone(draft);
      normalizeExpenseInput({operationId:nextId, expense:snapshot}, checkTodayISO());
      const surface = host(), supplier = catalog.suppliers.find(row => row.id === snapshot.supplierId);
      const confirmed = await confirmDialog('שמירת הוצאה ב־Sandbox', `${supplier?.name || ''} · חשבונית ${snapshot.number} · סה״כ ${snapshot.gross} ₪ · מע״מ ${snapshot.vat} ₪. האם הפרטים תואמים למסמך המקור?`, {confirmText:'שמור ב־Morning'});
      check();
      if (!confirmed || !surface?.isConnected || host() !== surface) return false;
      operationId = nextId; result = {state:'pending', verified:false}; remember();
      result = await request('create', {operationId, expense:snapshot}, check); check();
      message = result.verified ? 'ההוצאה נוצרה והפרטים אומתו בקריאה חוזרת. קובץ המקור מטופל בנפרד.' : 'השליחה טרם אומתה. יש לבדוק מצב; אין לשמור שוב.';
    });
  }
  function status() {
    return run(async () => {
      const check = capture();
      if (!operationId) return false;
      try { result = await request('operation_status', {operationId}, check); check(); }
      catch (error) { if (error.code === 'morning_expense_operation_missing') { check(); result = {state:'not_found', verified:false}; } else throw error; }
      message = result.verified ? 'היצירה אומתה. יש לוודא גם קישור קובץ מקור.' : result.state === 'not_found' ? 'השרת אישר שמזהה הפעולה אינו קיים. ניתן להתחיל קליטה חדשה.' : 'הפעולה עדיין דורשת בדיקה ב־Morning. אין ליצור את אותה חשבונית שוב.';
    });
  }
  function upload() {
    return run(async () => {
      const check = capture(true);
      if (!catalog?.capabilities.upload || !result?.verified || !selected || fileAttempted) throw new Error('יש לבחור קובץ ולהשלים אימות הוצאה לפני העלאה.');
      fileAttempted = true; // An uncertain upload is never silently replayed.
      const ticket = await request('upload_ticket', {operationId, contentType:selected.type, size:selected.file.size}, check); check();
      await files.upload(ticket, selected, check); check();
      message = 'הקובץ התקבל לעיבוד. קישורו להוצאה טרם אומת; יש ללחוץ על בדיקת קובץ.';
    });
  }
  function fileStatus() {
    return run(async () => {
      const check = capture();
      const value = await request('upload_status', {operationId}, check); check();
      result = {...result, fileLinked:value.fileLinked}; message = value.message;
      if (!value.fileLinked && value.fileState === 'not_started') fileAttempted = false;
    });
  }
  function next() {
    if (busy || operationId && !result?.verified && result?.state !== 'not_found') return false;
    if (operationId && result?.verified && selected && !result.fileLinked) { updateMessage('יש לאמת את קישור קובץ המקור לפני המעבר לחשבונית הבאה.'); return false; }
    if (operationId) { try { localStorage.removeItem(key()); } catch { updateMessage('לא ניתן לנקות את מזהה הפעולה.'); return false; } }
    operationId = ''; result = null; fileAttempted = false; draft = defaults(draft); selectNextFile(); message = 'מוכן לחשבונית הבאה.'; render(); return true;
  }
  function markup() {
    const disabled = busy || !!operationId, attrs = disabled ? 'disabled' : '';
    const option = (value, label, current) => `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
    const textField = (name, type = 'text') => `<label>${fieldLabels[name]}<input data-expense-field="${name}" data-input="morning-expense-field" type="${type}" ${['net', 'vat', 'gross'].includes(name) ? 'inputmode="decimal"' : ''} value="${esc(draft[name])}" ${attrs}></label>`;
    return `<section class="morning-expense-intake" data-morning-expense-intake data-keydown="morning-expense-keyboard" dir="rtl">
      <button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="${expanded}" ${busy ? 'disabled' : ''}><b>קליטת הוצאות ב־Morning</b><span>${expanded ? '⌃' : '⌄'}</span></button>
      ${expanded ? `<div class="morning-expense-content"><div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-load" ${busy ? 'disabled' : ''}>${catalog ? 'רענון ספקים וסיווגים' : 'טעינת ספקים וסיווגים'}</button><a href="https://app.greeninvoice.co.il" target="_blank" rel="noopener noreferrer">פתיחת Morning</a></div>
      <p class="morning-expense-notice">${catalog?.capabilities.create ? 'סביבת בדיקות Sandbox · יש לבדוק כל פרט מול מסמך המקור.' : 'קליטה לייצור טרם הופעלה. אפשר לעיין ולהכין פרטים; שמירה זמינה ב־Sandbox מורשה בלבד.'}</p>
      <p class="morning-expense-status" role="status" aria-live="polite" data-expense-message>${esc(busy ? 'הפעולה מתבצעת…' : message)}</p>
      ${catalog ? `<div class="morning-expense-workspace"><div class="morning-expense-fields">
      <label>ספק ב־Morning<select data-expense-field="supplierId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר ספק', draft.supplierId)}${catalog.suppliers.map(row => option(row.id, `${row.name} · ${row.taxId || 'ללא מספר עוסק'}`, draft.supplierId)).join('')}</select></label>
      <label>סיווג מהוצאות קיימות<select data-expense-field="classificationExpenseId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סיווג', draft.classificationExpenseId)}${catalog.classifications.map(row => option(row.sourceExpenseId, row.title, catalog.expenses.find(item => item.id === draft.classificationExpenseId)?.classification?.id === row.id ? row.sourceExpenseId : '')).join('')}</select></label>
      <small>סיווגים שנצפו בהוצאות בשנתיים האחרונות ובשנה הנוכחית; הרשימה אינה קטלוג הסיווגים המלא. אחוזי ההכרה מנוהלים ב־Morning.</small>
      <div class="morning-expense-pair"><label>סוג מסמך<select data-expense-field="documentType" data-change="morning-expense-field" ${attrs}>${option(305, 'חשבונית מס', draft.documentType)}${option(330, 'חשבונית זיכוי', draft.documentType)}</select></label>
      <label>סוג דיווח<select data-expense-field="pcnClassification" data-change="morning-expense-field" ${attrs}>${option('T', 'רגיל · T', draft.pcnClassification)}${option('P', 'חשבונית P', draft.pcnClassification)}</select></label></div>
      ${draft.pcnClassification === 'P' ? '<p class="morning-expense-notice">חשבונית P: המע״מ נשאר לפי מסמך המקור. הקליטה והסיווג לדוח יושלמו ב־Morning עד לאימות המסלול.</p>' : ''}
      <div class="morning-expense-pair">${textField('number')}${textField('date', 'date')}</div>
      <label>חודש דיווח<input type="month" value="${esc(draft.reportingDate.slice(0, 7))}" data-expense-field="reportingDate" data-change="morning-expense-field" ${attrs}></label>
      <div class="morning-expense-amounts">${textField('net')}${textField('vat')}${textField('gross')}</div>
      <small>מע״מ מוקלד במפורש. סכום הנטו והמע״מ חייב להתאים לסכום הכולל. זיכוי מוקלד בסכומים חיוביים לבדיקת Sandbox.</small>
      ${textField('description')}${textField('allocationNumber')}
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-save" ${disabled || !catalog.capabilities.create || draft.pcnClassification === 'P' ? 'disabled' : ''}>בדיקה ושמירה ב־Sandbox</button>
      <button type="button" class="btn" data-action="morning-expense-next" ${busy || operationId && !result?.verified && result?.state !== 'not_found' ? 'disabled' : ''}>${queue.length ? 'לחשבונית הבאה בתור' : 'קליטה חדשה'}</button></div>
      ${operationId ? `<div class="morning-expense-operation"><b>${esc(stateLabels[result?.state] || 'מצב הפעולה טרם אומת')}</b><small>מזהה פעולה: <bdi>${esc(operationId)}</bdi></small><button type="button" class="btn" data-action="morning-expense-status" ${busy ? 'disabled' : ''}>בדיקת מצב היצירה</button><span>קובץ מקור: ${result?.fileLinked ? 'Morning מציגה קובץ מצורף' : 'טרם אומת'} · אישור ודיווח נבדקים ב־Morning</span></div>` : ''}
      </div><div class="morning-expense-source" data-drop="morning-expense-drop" data-dragover="morning-expense-dragover"><label class="morning-expense-drop">בחירת קובצי מקור · גרירה או הדבקה<input type="file" multiple accept="application/pdf,image/jpeg,image/png" data-change="morning-expense-files" ${busy || fileAttempted || operationId && !result?.verified ? 'disabled' : ''}></label>
      <small>PDF, JPG או PNG עד 20MB לקובץ · הקבצים נשארים בזיכרון עד להעלאה. ${queue.length ? `${queue.length} נוספים בתור` : ''}</small>
      ${selected ? `<b>${esc(selected.name)}</b>${selected.type === 'application/pdf' ? `<iframe src="${esc(previewUrl)}" title="חשבונית מקור לבדיקה"></iframe>` : `<img src="${esc(previewUrl)}" alt="חשבונית מקור לבדיקה">`}` : '<p>בחר קובץ להצגתו לצד השדות.</p>'}
      ${result?.verified ? `<button type="button" class="btn" data-action="morning-expense-upload" ${busy || fileAttempted || !selected || !catalog.capabilities.upload || result.fileLinked ? 'disabled' : ''}>העלאת הקובץ ל־Morning</button><button type="button" class="btn" data-action="morning-expense-file-status" ${busy ? 'disabled' : ''}>בדיקת קישור הקובץ</button>` : ''}</div></div>` : ''}</div>` : ''}</section>`;
  }
  const actions = {
    'morning-expense-toggle':() => { if (busy) return false; expanded = !expanded; render(); return true; },
    'morning-expense-load':load, 'morning-expense-field':setField, 'morning-expense-save':save, 'morning-expense-status':status,
    'morning-expense-next':next, 'morning-expense-upload':upload, 'morning-expense-file-status':fileStatus,
    'morning-expense-files':element => chooseFiles(element.files),
    'morning-expense-dragover':(_, event) => event.preventDefault(),
    'morning-expense-drop':(_, event) => { event.preventDefault(); return chooseFiles(event.dataTransfer?.files || []); },
    'morning-expense-keyboard':(_, event) => {if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); return save();} return false;},
  };
  return {markup, actions, runtime:{isPending:tasks.isPending, drain:tasks.drain, dispose:() => {if (!tasks.close()) return false; clear(); unsubscribe(); return true;}}};
}
