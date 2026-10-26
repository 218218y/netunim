import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeExpenseInput} from '../../core/morning-expense-input.js';
import {expenseBimonth, expenseReportingChoice} from '../../core/morning-report-period.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {readExpenseCatalog, readExpenseCatalogPage, expenseCatalogClassifications, expenseSupplierEligibility} from './morning-expense-catalog.js';
import {readExpensePreferences, writeExpensePreferences} from './morning-expense-preferences.js';
import {readExpenseRecovery, writeExpenseRecovery, clearExpenseRecovery} from './morning-expense-recovery.js';

const stateLabels = {reserved:'טרם נשלחה · אפשר לבטל בבטחה', cancelled:'בוטלה לפני שליחה', pending:'נשלחה · טרם אומתה', created_unverified:'נוצרה · אימות הפרטים ממתין', created:'נוצרה והפרטים אומתו', needs_reconciliation:'תוצאה לא ברורה · נדרש בירור ב־Morning', blocked:'הפעולה נחסמה · נדרש בירור'};
const fieldLabels = {number:'מספר חשבונית', date:'תאריך המסמך', net:'לפני מע״מ', vat:'מע״מ מהחשבונית', gross:'כולל מע״מ', description:'תיאור', allocationNumber:'מספר הקצאה, אם נדרש'};
const fileLabels = {not_started:'העלאה טרם התחילה', prepared:'הכנה הושלמה · אפשר להכין מחדש', upload_started:'הנפקת הרשאת העלאה בבדיקה', ticket_issued:'הרשאת העלאה נמסרה · נדרשת בדיקת קישור', file_accepted:'הקובץ התקבל לעיבוד · הקישור טרם אומת', file_linked:'Morning מציגה קובץ מצורף'};
export function createMorningExpenseIntake({request:sendRequest, captureRead, captureWrite, accountId, subscribeAccountScope, confirmDialog, files, todayISO = checkTodayISO, isActive = () => true}) {
  const tasks = createRuntimeTaskOwner();
  let expanded = false, catalog = null, busy = false, generation = 0, reading = null, message = '', result = null, operationId = '', fileAttempted = false;
  let queue = [], selected = null, previewUrl = '', reconciliationId = '', supplierQuery = '', searchedQuery = '', favorites = [], extraExpenses = [], preferences = null, historyYear = todayISO().slice(0, 4), draft = defaults();
  function defaults(previous = {}) {
    const today = todayISO();
    return {supplierId:previous.supplierId || '', classificationExpenseId:previous.classificationExpenseId || '', documentType:305, number:'',
      date:today, reportingDate:today.slice(0, 7) + '-01', reportingPeriod:expenseBimonth(today).key, reportingDateConfirmed:false,
      net:'', vat:'', gross:'', description:'', allocationNumber:'', pcnClassification:'T'};
  }
  const host = () => document.querySelector('[data-morning-expense-intake]');
  const active = () => tasks.isActive() && isActive();
  function capture(write = false) {
    const check = write ? captureWrite() : captureRead(), epoch = generation;
    return () => { check(); if (!active() || generation !== epoch) throw new Error('פעולת ההוצאות שייכת למסך או להתחברות קודמים.'); };
  }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  async function request(action, payload, check, options) {
    const expectedEnvironment = payload?.expectedEnvironment || (['create', 'operation_status', 'reconcile', 'cancel_reserved', 'upload_prepare', 'upload_ticket', 'upload_ack', 'upload_status'].includes(action) ? catalog?.capabilities.environment : undefined);
    const value = await sendRequest(action, {...payload, ...(expectedEnvironment ? {expectedEnvironment} : {})}, check, options); check();
    if (expectedEnvironment && (value.environment !== expectedEnvironment || value.version !== 1)) throw new Error('סביבת Morning השתנתה. יש לבדוק מצב לאחר רענון המסך.');
    return value;
  }
  function remember() {
    // Persist before POST; a failure to persist blocks submission. No invoice data or file bytes are retained.
    writeExpenseRecovery(localStorage, accountId(), catalog.capabilities.environment, operationId);
  }
  function restore() {
    try {
      const saved = readExpenseRecovery(localStorage, accountId(), catalog.capabilities.environment);
      if (saved) {
        operationId = saved.operationId; result = {state:'needs_reconciliation', verified:false}; message = 'נמצאה פעולה קודמת. יש לבדוק את מצבה לפני קליטה נוספת.';
      }
    } catch { /* No prior recovery metadata. */ }
  }
  function clear() {
    reading?.abort(); reading = null; generation++; catalog = null; busy = false; message = ''; result = null; operationId = ''; fileAttempted = false;
    queue = []; selected = null; reconciliationId = ''; supplierQuery = ''; searchedQuery = ''; favorites = []; extraExpenses = []; preferences = null; historyYear = todayISO().slice(0, 4); releasePreview(); draft = defaults();
  }
  const unsubscribe = subscribeAccountScope(() => { clear(); render(); });
  function render() {
    if (!active()) return;
    const target = host(); if (!target) return;
    target.outerHTML = markup();
  }
  function updateMessage(value) { message = value; const output = host()?.querySelector('[data-expense-message]'); if (output) output.textContent = value; }
  function run(work) {
    if (busy || !active()) return false;
    const epoch = generation; busy = true; render();
    return tasks.run(async () => {
      try { return await work(); }
      catch (error) { if (generation === epoch && active()) message = ({
        invalid_expense_input:'יש לבדוק ספק, סיווג, מספר חשבונית עד 20 תווים ותאריכים.',
        invalid_expense_amounts:'סכומי הנטו והמע״מ חייבים להתאים לסכום הכולל, בדיוק של אגורות.',
        invalid_expense_reporting_period:'חודש הדיווח חייב להשתייך לתקופה הנבחרת, לא להיות עתידי ולא להקדים את חודש החשבונית.',
        expense_reporting_confirmation_required:'יש לאשר במפורש את השיוך לחודש דיווח מאוחר מחודש החשבונית.',
        morning_expense_p_profiles_unverified:'שתי זהויות ספקי P עדיין לא אומתו מול Morning.',
        morning_expense_p_unverified:'חשבוניות P ייקלטו ב־Morning עד לאימות המסלול.'
      })[error.message] || error.message || 'הפעולה לא הושלמה.'; return false; }
      finally { if (generation === epoch && active()) { busy = false; render(); } }
    });
  }
  function load() {
    return run(async () => {
      const check = capture(), controller = new AbortController(); reading = controller;
      const loaded = await readExpenseCatalog(request, check, todayISO(), {signal:controller.signal}); check();
      if (operationId && catalog?.capabilities.environment !== loaded.capabilities.environment) throw new Error('סביבת Morning השתנתה. הפעולה הקודמת נשמרה לשחזור בסביבתה; יש לפתוח מחדש את המסך.');
      preferences = readExpensePreferences(localStorage, accountId(), loaded.capabilities.environment);
      const restored = [];
      for (const id of preferences.favorites) {
        let supplier = loaded.suppliers.find(row => row.id === id);
        if (!supplier) {try {supplier = await canonicalItem('get_supplier', id, check, loaded.capabilities.environment);} catch {check();}}
        if (supplier?.id === id && supplier.active) restored.push(supplier);
      }
      check(); favorites = restored; extraExpenses = [];
      const retained = catalog?.suppliers.filter(row => row.id === draft.supplierId) || [];
      catalog = loaded; catalog.suppliers = mergeSuppliers(loaded.suppliers, retained); searchedQuery = ''; supplierQuery = '';
      reading = null; message = 'נטען עמוד הצעות ראשוני. אפשר לחפש ספקים ולהוסיף סיווגים לפי הצורך.';
      if (draft.classificationExpenseId && !loaded.expenses.some(row => row.id === draft.classificationExpenseId)) {
        draft.classificationExpenseId = ''; message = 'ההצעות רועננו. יש לבחור שוב את סיווג ההוצאה לפני שמירה.';
      }
      if (!operationId) restore();
    });
  }
  function setField(element) {
    if (!busy && element.dataset.expenseField === 'reconciliationId') {reconciliationId = element.value; return true;}
    if (!busy && !operationId && element.dataset.expenseField === 'supplierQuery') {supplierQuery = element.value; return true;}
    if (!busy && !operationId && element.dataset.expenseField === 'historyYear') {historyYear = element.value; return true;}
    if (busy || operationId) return false;
    const name = element.dataset.expenseField;
    if (!Object.hasOwn(draft, name)) return false;
    draft[name] = name === 'documentType' ? Number(element.value) : name === 'reportingDateConfirmed' ? element.checked : name === 'reportingDate' && element.value.length === 7 ? element.value + '-01' : element.value;
    if (['date', 'reportingPeriod'].includes(name)) {
      try {
        draft.reportingDate = expenseReportingChoice(draft.date, draft.reportingPeriod, todayISO()).reportingDate;
        draft.reportingDateConfirmed = false; render();
      } catch {updateMessage('יש לבחור תאריך מסמך ותקופת דיווח תקינים.');}
      return true;
    }
    if (name === 'reportingDate') {draft.reportingDateConfirmed = false; render(); return true;}
    if (name === 'supplierId') {
      const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
      const history = catalog?.expenses.filter(row => row.status !== 100 && (row.supplierId === draft.supplierId || supplier?.taxId && row.supplierTaxId === supplier.taxId)).sort((a, b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)));
      const recent = history?.find(row => row.classification?.id);
      draft.classificationExpenseId = recent?.id || '';
      draft.pcnClassification = history?.some(row => row.pcnClassification === 'P') || expenseSupplierEligibility(supplier, catalog?.capabilities.pSuppliers).p ? 'P' : 'T';
      render();
      if (supplier && preferences?.classifications.some(row => row.supplierId === supplier.id)) return restoreClassification(supplier.id);
    } else if (name === 'pcnClassification') render();
    else updateMessage('הפרטים טרם נשמרו. יש לבדוק מול מסמך המקור.');
    return true;
  }
  async function chooseFiles(selection) {
    if (busy || operationId && !result?.verified || fileAttempted) return false;
    return run(async () => {
      const check = capture(), list = Array.from(selection);
      const existing = [...(selected ? [selected] : []), ...queue];
      if (!list.length || list.length + existing.length > 20 || list.reduce((sum, file) => sum + file.size, existing.reduce((sum, item) => sum + item.file.size, 0)) > 100 * 1024 * 1024) throw new Error('ניתן לבחור עד 20 קבצים ובסך הכול עד 100MB.');
      const validated = [];
      for (const file of list) { validated.push(await files.validate(file)); check(); }
      queue.push(...validated); if (!selected) selectNextFile(); message = 'הקבצים נוספו לתור. נתונים לא פוענחו אוטומטית.';
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
      if (selected && !catalog.capabilities.upload) throw new Error('צירוף קבצים עדיין כבוי בחשבון זה. אין לשמור הוצאה עם קובץ בתור עד להפעלתו.');
      const eligibility = expenseSupplierEligibility(catalog.suppliers.find(row => row.id === draft.supplierId), catalog.capabilities.pSuppliers);
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      const nextId = crypto.randomUUID(), snapshot = structuredClone(draft);
      normalizeExpenseInput({operationId:nextId, expense:snapshot}, todayISO());
      const classification = sourceExpenses().find(row => row.id === snapshot.classificationExpenseId)?.classification;
      if (!classification?.id) throw new Error('יש לבחור סיווג מתוך ההצעות המוצגות לפני שמירה.');
      const surface = host(), supplier = catalog.suppliers.find(row => row.id === snapshot.supplierId);
      const details = `${supplier?.name || ''} · ${snapshot.documentType === 330 ? 'חשבונית זיכוי' : 'חשבונית מס'} ${snapshot.number} · תאריך ${snapshot.date} · סיווג ${classification.title}`;
      const amounts = `לפני מע״מ ${snapshot.net} ₪ · מע״מ ${snapshot.vat} ₪ · סה״כ ${snapshot.gross} ₪`;
      const period = `תקופה ${expenseBimonth(snapshot.reportingDate).label} · חודש דיווח ${snapshot.reportingDate.slice(0, 7)}`;
      const confirmed = await confirmDialog(catalog.capabilities.environment === 'production' ? 'שמירת הוצאה בחשבון Morning האמיתי' : 'שמירת הוצאה ב־Sandbox', `${details} · ${amounts} · ${period}. האם הפרטים תואמים למסמך המקור?`, {confirmText:'שמור ב־Morning'});
      check();
      if (!confirmed || !surface?.isConnected || host() !== surface) return false;
      operationId = nextId; result = {state:'pending', verified:false}; remember();
      result = await request('create', {operationId, expense:snapshot}, check); check();
      if (result.verified) rememberClassification(snapshot.supplierId, snapshot.classificationExpenseId);
      message = result.verified ? 'ההוצאה נוצרה והפרטים אומתו בקריאה חוזרת. קובץ המקור מטופל בנפרד.' : 'השליחה טרם אומתה. יש לבדוק מצב; אין לשמור שוב.';
    });
  }
  function status() {
    return run(async () => {
      const check = capture();
      if (!operationId) return false;
      try { result = await request('operation_status', {operationId}, check); check(); }
      catch (error) {
        check();
        if (error.code === 'morning_expense_operation_missing') result = {state:'not_found', verified:false};
        else {if (result?.verified) result = {...result, state:'created_unverified', verified:false}; throw error;}
      }
      if (result.fileState) fileAttempted = !['not_started', 'prepared'].includes(result.fileState);
      message = result.verified ? 'היצירה אומתה. יש לוודא גם קישור קובץ מקור.' : result.state === 'not_found' ? 'השרת אישר שמזהה הפעולה אינו קיים. ניתן להתחיל קליטה חדשה.' : 'הפעולה עדיין דורשת בדיקה ב־Morning. אין ליצור את אותה חשבונית שוב.';
    });
  }
  function upload() {
    return run(async () => {
      const check = capture(true);
      if (!catalog?.capabilities.upload || !result?.verified || !selected || fileAttempted) throw new Error('יש לבחור קובץ ולהשלים אימות הוצאה לפני העלאה.');
      fileAttempted = true; // An uncertain upload is never silently replayed.
      const preparation = await request('upload_prepare', {operationId, contentType:selected.type, size:selected.file.size}, check); check();
      result = {...result, fileState:'prepared'};
      const ticket = await request('upload_ticket', {operationId, fileGeneration:preparation.fileGeneration}, check); check();
      result = {...result, fileState:'ticket_issued'};
      await files.upload(ticket, selected, check); check();
      await request('upload_ack', {operationId, fileGeneration:ticket.fileGeneration}, check); check();
      result = {...result, fileState:'file_accepted'};
      message = 'הקובץ התקבל לעיבוד. קישורו להוצאה טרם אומת; יש ללחוץ על בדיקת קובץ.';
    });
  }
  function fileStatus() {
    return run(async () => {
      const check = capture();
      const value = await request('upload_status', {operationId}, check); check();
      result = {...result, fileLinked:value.fileLinked, fileState:value.fileState}; message = value.message;
      if (!value.fileLinked && ['not_started', 'prepared'].includes(value.fileState)) fileAttempted = false;
      else if (!value.fileLinked) message += ' אין להעלות שוב: ייתכן שהקובץ עדיין בעיבוד. יש לבדוק את ההוצאה ב־Morning לפי המזהה המוצג ולפנות לתמיכה אם הקישור אינו מופיע.';
    });
  }
  function next() {
    if (busy || operationId && !result?.verified && !['not_found', 'cancelled'].includes(result?.state)) return false;
    const filePending = result?.fileState && !['not_started', 'prepared'].includes(result.fileState);
    if (operationId && result?.verified && (selected || filePending) && !result.fileLinked) { updateMessage('יש לאמת את קישור קובץ המקור לפני המעבר לחשבונית הבאה.'); return false; }
    if (operationId) { try { clearExpenseRecovery(localStorage, accountId(), catalog.capabilities.environment); } catch { updateMessage('לא ניתן לנקות את מזהה הפעולה.'); return false; } }
    const completed = result?.verified;
    operationId = ''; result = null; fileAttempted = false; reconciliationId = ''; draft = defaults(draft);
    if (completed) selectNextFile(); message = 'מוכן לחשבונית הבאה.'; render(); return true;
  }
  function mergeSuppliers(found, retained = []) {
    return [...new Map([...favorites, ...retained, ...found].map(row => [row.id, row])).values()];
  }
  function sourceExpenses() {return [...(catalog?.expenses || []), ...extraExpenses];}
  async function canonicalItem(action, id, check, environment = catalog.capabilities.environment) {
    const value = await request(action, {id, expectedEnvironment:environment}, check); check();
    if (value.version !== 1 || value.environment !== environment || value.item?.id !== id) throw new Error('לא ניתן לאמת את ההעדפה בחשבון Morning הנוכחי.');
    return value.item;
  }
  function persistPreferences() {
    if (!preferences || !catalog) return false;
    preferences.favorites = favorites.map(row => row.id);
    return writeExpensePreferences(localStorage, accountId(), catalog.capabilities.environment, preferences);
  }
  function rememberClassification(supplierId, expenseId) {
    if (!preferences) return;
    preferences.classifications = [{supplierId, expenseId}, ...preferences.classifications.filter(row => row.supplierId !== supplierId)].slice(0, 32);
    persistPreferences();
  }
  function restoreClassification(supplierId) {
    return run(async () => {
      const check = capture(), saved = preferences?.classifications.find(row => row.supplierId === supplierId);
      if (!saved) return false;
      let item = sourceExpenses().find(row => row.id === saved.expenseId);
      if (!item) {try {item = await canonicalItem('get_expense', saved.expenseId, check);} catch {check(); message = 'לא ניתן לאמת כעת את הסיווג השמור. אפשר לבחור סיווג מההצעות ולנסות שוב בהמשך.'; return false;}}
      if (draft.supplierId !== supplierId) return false;
      if (item?.id !== saved.expenseId || item.kind !== 'expense' || item.status === 100 || !item.classification?.id) {
        preferences.classifications = preferences.classifications.filter(row => row.supplierId !== supplierId); persistPreferences();
        message = 'הסיווג השמור אינו זמין לאימות. יש לבחור סיווג מההצעות.'; return false;
      }
      if (!sourceExpenses().some(row => row.id === item.id)) extraExpenses.push(item);
      catalog.classifications = expenseCatalogClassifications(sourceExpenses());
      draft.classificationExpenseId = catalog.classifications.find(row => row.id === item.classification.id).sourceExpenseId;
      message = 'הסיווג ששימש אותך אומת מחדש מול Morning ומוצע לבחירתך.';
    });
  }
  function supplierSearch(element) {
    if (!catalog || operationId) return false;
    return run(async () => {
      const check = capture(), step = Number(element?.dataset.expenseStep || 0), query = (step ? searchedQuery : supplierQuery).trim();
      const page = step ? catalog.supplierPage.page + step : 0;
      if (page < 0 || page >= 1000) return false;
      const filter = /^\d{9}$/.test(query) ? {taxId:query} : {name:query};
      const value = await readExpenseCatalogPage(request, catalog.capabilities, 'suppliers', filter, page, check); check();
      const retained = catalog.suppliers.filter(row => row.id === draft.supplierId);
      catalog.suppliers = mergeSuppliers(value.items, retained); catalog.supplierPage = value; searchedQuery = query; supplierQuery = query;
      message = value.total ? `החיפוש מצא ${value.total} ספקים. מוצג עמוד ${page + 1}.` : 'לא נמצאו ספקים מתאימים לחיפוש.';
    });
  }
  function moreClassifications() {
    if (!catalog || operationId) return false;
    return run(async () => {
      const check = capture(), page = catalog.expensePage.page + 1;
      if (page >= catalog.expensePage.pages || page >= 20) return false;
      const value = await readExpenseCatalogPage(request, catalog.capabilities, 'expenses', {fromDate:catalog.fromDate, toDate:catalog.toDate}, page, check); check();
      const seen = new Set(catalog.expenses.map(row => row.id));
      if (value.total !== catalog.expensePage.total || value.items.some(row => seen.has(row.id))) throw new Error('רשימת ההוצאות השתנתה. יש לרענן את ההצעות.');
      catalog.expenses.push(...value.items); catalog.classifications = expenseCatalogClassifications(sourceExpenses()); catalog.expensePage = value;
      message = `הצעות הסיווגים מבוססות כעת על ${catalog.expenses.length} הוצאות. הרשימה אינה קטלוג מלא.`;
    });
  }
  function classificationYear() {
    if (!catalog || operationId) return false;
    return run(async () => {
      const check = capture(), year = Number(historyYear), current = todayISO();
      if (!Number.isInteger(year) || year < 2010 || year > Number(current.slice(0, 4))) throw new Error('יש לבחור שנת הוצאות תקינה.');
      const fromDate = year + '-01-01', toDate = year === Number(current.slice(0, 4)) ? current.slice(0, 7) + '-01' : year + '-12-01';
      const value = await readExpenseCatalogPage(request, catalog.capabilities, 'expenses', {fromDate, toDate}, 0, check); check();
      catalog.expenses = value.items; catalog.expensePage = value; catalog.fromDate = fromDate; catalog.toDate = toDate;
      catalog.classifications = expenseCatalogClassifications(sourceExpenses());
      if (!sourceExpenses().some(row => row.id === draft.classificationExpenseId)) draft.classificationExpenseId = '';
      message = 'נטענו הצעות מתוך שנת ההוצאות שנבחרה. יש לבדוק ולבחור את הסיווג המתאים.';
    });
  }
  function favorite() {
    if (busy || operationId) return false;
    const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId); if (!supplier) return false;
    if (favorites.some(row => row.id === supplier.id)) favorites = favorites.filter(row => row.id !== supplier.id);
    else if (favorites.length < 8) favorites.push(supplier);
    else {updateMessage('אפשר לסמן עד שמונה ספקים מועדפים במסך הנוכחי.'); return false;}
    if (!persistPreferences()) updateMessage('המועדפים זמינים במסך זה; לא ניתן לשמור אותם בדפדפן כעת.');
    render(); return true;
  }
  function queueChange(element) {
    if (busy || operationId || fileAttempted) return false;
    const index = Number(element.dataset.expenseIndex), remove = element.dataset.expenseCommand === 'remove-file';
    if (!Number.isInteger(index) || index < 0 || index > queue.length) return false;
    const items = [...(selected ? [selected] : []), ...queue];
    if (remove) items.splice(index, 1);
    else {const [item] = items.splice(index, 1); if (!item) return false; items.unshift(item);}
    queue = items; selectNextFile(); message = remove ? 'הקובץ הוסר מהתור המקומי.' : 'הקובץ נבחר לבדיקה. פרטי הטופס נשארו לבדיקה מול הקובץ.'; render(); return true;
  }
  function recover(action) {
    return run(async () => {
      const check = capture(true), surface = host(), id = reconciliationId.trim();
      if (!operationId || action === 'reconcile' && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new Error('יש להזין מזהה הוצאה תקין מתוך Morning.');
      const approved = await confirmDialog(action === 'reconcile' ? 'אימות הוצאה קיימת ב־Morning' : 'ביטול פעולה שטרם נשלחה',
        action === 'reconcile' ? 'השרת ישווה את כל פרטי ההוצאה לבקשה המקורית. לא תיווצר הוצאה חדשה.' : 'הביטול יתאפשר רק אם השרת מאשר שהפעולה טרם נשלחה. לאחר הביטול אפשר יהיה להתחיל קליטה חדשה.', {confirmText:'בדוק ואשר'});
      check(); if (!approved || !surface?.isConnected || host() !== surface) return false;
      result = await request(action, {operationId, ...(action === 'reconcile' ? {expenseId:id} : {})}, check); check();
      message = result.cancelled ? 'הפעולה בוטלה לפני שליחה. אפשר להתחיל קליטה חדשה.' : result.verified ? 'ההוצאה הקיימת תואמת לבקשה המקורית ואומתה.' : 'השחזור עדיין דורש בירור ב־Morning.';
    });
  }
  function environmentNotice() {
    const caps = catalog?.capabilities;
    if (!caps) return 'יש לטעון ספקים וסיווגים כדי לבדוק את סביבת Morning והרשאותיה.';
    let notice;
    if (caps.environment === 'production') notice = caps.create ?
      'חשבון Morning האמיתי · השמירה יוצרת הוצאה אמיתית. יש לבדוק כל פרט מול מסמך המקור.' : 'חשבון Morning האמיתי · יצירת הוצאות כבויה או אינה מורשית למשתמש זה.';
    else notice = caps.create ? 'סביבת בדיקות Sandbox · יש לבדוק כל פרט מול מסמך המקור.' : 'סביבת Sandbox · שמירה דורשת הרשאה ושתי זהויות ספקי P שאומתו מול Morning.';
    return notice + (caps.create && !caps.upload ? ' צירוף קבצים עדיין כבוי.' : '');
  }
  function markup() {
    const disabled = busy || !!operationId, attrs = disabled ? 'disabled' : '';
    const option = (value, label, current, unavailable = false) => `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''} ${unavailable ? 'disabled' : ''}>${esc(label)}</option>`;
    const textField = (name, type = 'text') => `<label>${fieldLabels[name]}<input data-expense-field="${name}" data-${type === 'date' ? 'change' : 'input'}="morning-expense-field" type="${type}" ${name === 'number' ? 'maxlength="20"' : ''} ${['net', 'vat', 'gross'].includes(name) ? 'inputmode="decimal"' : ''} value="${esc(draft[name])}" ${attrs}></label>`;
    const today = todayISO(), periods = [];
    for (let year = Number(today.slice(0, 4)); year >= 2010; year--) for (let month = 11; month >= 1; month -= 2) {
      const date = `${year}-${String(month).padStart(2, '0')}-01`;
      if (date <= today) periods.push(expenseBimonth(date));
    }
    const period = periods.find(item => item.key === draft.reportingPeriod) || expenseBimonth(today);
    const shifted = draft.reportingDate !== draft.date.slice(0, 7) + '-01';
    const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
    const eligibility = expenseSupplierEligibility(supplier, catalog?.capabilities.pSuppliers);
    const supplierOption = row => {
      const check = expenseSupplierEligibility(row, catalog.capabilities.pSuppliers);
      return option(row.id, `${row.name} · ${row.taxId || 'ללא מספר עוסק'}${check.reason ? ' · ' + check.reason : ''}`, draft.supplierId, !check.eligible && !check.p);
    };
    return `<section class="morning-expense-intake" data-morning-expense-intake data-keydown="morning-expense-keyboard" data-paste="morning-expense-paste" dir="rtl">
      <button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="${expanded}" ${busy ? 'disabled' : ''}><b>קליטת הוצאות ב־Morning</b><span>${expanded ? '⌃' : '⌄'}</span></button>
      ${expanded ? `<div class="morning-expense-content"><div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="load" ${busy ? 'disabled' : ''}>${catalog ? 'רענון הצעות' : 'טעינת ספקים וסיווגים'}</button><a href="${catalog?.capabilities.environment === 'sandbox' ? 'https://app.sandbox.d.greeninvoice.co.il' : 'https://app.greeninvoice.co.il'}" target="_blank" rel="noopener noreferrer">פתיחת Morning</a></div>
      <p class="morning-expense-notice">${esc(environmentNotice())}</p>
      <p class="morning-expense-status" role="status" aria-live="polite" data-expense-message>${esc(busy ? 'הפעולה מתבצעת…' : message)}</p>
      ${catalog ? `<div class="morning-expense-workspace"><div class="morning-expense-fields">
      ${!operationId ? `
      <label>חיפוש ספק לפי שם או מספר עוסק<input data-expense-field="supplierQuery" data-input="morning-expense-field" maxlength="180" value="${esc(supplierQuery)}" ${attrs}></label>
      <div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="search" ${attrs}>חיפוש ספקים</button>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="search" data-expense-step="-1" ${disabled || !catalog.supplierPage.page ? 'disabled' : ''}>עמוד קודם</button>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="search" data-expense-step="1" ${disabled || catalog.supplierPage.page + 1 >= catalog.supplierPage.pages || catalog.supplierPage.page >= 999 ? 'disabled' : ''}>עמוד הבא</button></div>
      <small>החיפוש מציג עד 50 ספקים בעמוד. הבחירה הנוכחית והמועדפים נשארים זמינים.</small>
      <label>ספק ב־Morning<select data-expense-field="supplierId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר ספק', draft.supplierId)}${catalog.suppliers.map(supplierOption).join('')}</select></label>
      ${supplier && !eligibility.eligible ? `<small>${esc(eligibility.reason)}</small>` : ''}
      <div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="favorite" ${disabled || !supplier ? 'disabled' : ''}>${favorites.some(row => row.id === draft.supplierId) ? 'הסרה מהמועדפים' : 'הוספה למועדפים שלי'}</button>
      ${favorites.map(row => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="use-favorite" data-expense-supplier="${esc(row.id)}" ${attrs}>${esc(row.name)}</button>`).join('')}</div>
      <label>סיווג מהוצאות קיימות<select data-expense-field="classificationExpenseId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סיווג', draft.classificationExpenseId)}${catalog.classifications.map(row => option(row.sourceExpenseId, row.title, sourceExpenses().find(item => item.id === draft.classificationExpenseId)?.classification?.id === row.id ? row.sourceExpenseId : '')).join('')}</select></label>
      <small>הצעות מתוך ${catalog.expenses.length} הוצאות בטווח ${esc(catalog.fromDate)}–${esc(catalog.toDate)}. הרשימה אינה קטלוג מלא. אחוזי ההכרה מנוהלים ב־Morning.</small>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="more-classifications" ${disabled || catalog.expensePage.page + 1 >= catalog.expensePage.pages || catalog.expensePage.page >= 19 ? 'disabled' : ''}>חיפוש סיווגים בהוצאות נוספות</button>
      <label>סיווג מהוצאות בשנה אחרת<select data-expense-field="historyYear" data-change="morning-expense-field" ${attrs}>${Array.from({length:Number(today.slice(0, 4)) - 2009}, (_, index) => Number(today.slice(0, 4)) - index).map(year => option(year, year, historyYear)).join('')}</select></label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="classification-year" ${attrs}>טעינת סיווגים מהשנה הנבחרת</button>
      <div class="morning-expense-pair"><label>סוג מסמך<select data-expense-field="documentType" data-change="morning-expense-field" ${attrs}>${option(305, 'חשבונית מס', draft.documentType)}${option(330, 'חשבונית זיכוי', draft.documentType)}</select></label>
      <label>סוג דיווח<select data-expense-field="pcnClassification" data-change="morning-expense-field" ${attrs}>${option('T', 'רגיל · T', draft.pcnClassification)}${option('P', 'חשבונית P', draft.pcnClassification)}</select></label></div>
      ${draft.pcnClassification === 'P' ? '<p class="morning-expense-notice">חשבונית P: המע״מ נשאר לפי מסמך המקור. הקליטה והסיווג לדוח יושלמו ב־Morning עד לאימות המסלול.</p>' : ''}
      <div class="morning-expense-pair">${textField('number')}${textField('date', 'date')}</div>
      <label>תקופת דיווח מע״מ דו־חודשית<select data-expense-field="reportingPeriod" data-change="morning-expense-field" ${attrs}>${periods.map(item => option(item.key, item.label, draft.reportingPeriod)).join('')}</select></label>
      <label>חודש הדיווח המדויק ב־Morning<select data-expense-field="reportingDate" data-change="morning-expense-field" ${attrs}>${period.months.map(month => `<option value="${month}" ${month === draft.reportingDate ? 'selected' : ''} ${month > today || month < draft.date.slice(0, 7) + '-01' ? 'disabled' : ''}>${month.slice(5, 7)}/${month.slice(0, 4)}</option>`).join('')}</select></label>
      <small>תאריך החשבונית נשמר בנפרד. שתי אפשרויות החודש משתייכות לתקופת ${esc(period.label)}; ב־Morning נשלח תאריך חודשי מדויק.</small>
      ${shifted ? `<label class="morning-expense-report-confirm"><input type="checkbox" data-expense-field="reportingDateConfirmed" data-change="morning-expense-field" ${draft.reportingDateConfirmed ? 'checked' : ''} ${attrs}> בדקתי ואישרתי שיוך לחודש דיווח מאוחר מחודש החשבונית, בהתאם לכללי העבודה החשבונאיים.</label>` : ''}
      <div class="morning-expense-amounts">${textField('net')}${textField('vat')}${textField('gross')}</div>
      <small>מע״מ מוקלד במפורש. סכום הנטו והמע״מ חייב להתאים לסכום הכולל. זיכוי מוקלד בסכומים חיוביים; סוג המסמך קובע את ההפחתה בדוח.</small>
      ${textField('description')}${textField('allocationNumber')}
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-save" ${disabled || !catalog.capabilities.create || !eligibility.eligible || draft.pcnClassification === 'P' ? 'disabled' : ''}>${catalog.capabilities.environment === 'production' ? 'בדיקה ושמירה בחשבון האמיתי' : 'בדיקה ושמירה ב־Sandbox'}</button></div>` : ''}
      <div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="next" ${busy || operationId && !result?.verified && !['not_found', 'cancelled'].includes(result?.state) ? 'disabled' : ''}>${queue.length ? 'לחשבונית הבאה בתור' : 'קליטה חדשה'}</button></div>
      ${operationId ? `<div class="morning-expense-operation"><b>${esc(stateLabels[result?.state] || 'מצב הפעולה טרם אומת')}</b><small>מזהה פעולה: <bdi>${esc(operationId)}</bdi></small><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="status" ${busy ? 'disabled' : ''}>בדיקת מצב היצירה</button>
      ${result?.expenseId ? `<small>מזהה הוצאה ב־Morning: <bdi>${esc(result.expenseId)}</bdi></small>` : ''}
      ${result?.intent ? `<p data-expense-receipt><strong>${result.verified ? 'פרטי ההוצאה שאומתו' : 'פרטי הבקשה המקורית'}</strong>
      ${esc(result.intent.supplierName)} · ${result.intent.documentType === 330 ? 'זיכוי' : 'חשבונית'} ${esc(result.intent.number)} · תאריך ${esc(result.intent.date)} · דיווח ${esc(result.intent.reportingDate?.slice(0, 7))} · סה״כ ${esc(result.intent.amount)} ₪ · מע״מ ${esc(result.intent.vat)} ₪</p>` : '<p>פרטי הפעולה ייקראו מיומן השרת בבדיקת מצב. אין להזין את החשבונית מחדש.</p>'}
      ${result?.state === 'reserved' ? `<button type="button" class="btn" data-action="morning-expense-write" data-expense-command="cancel" ${busy ? 'disabled' : ''}>ביטול בטוח לפני שליחה</button>` : ''}
      ${['pending', 'needs_reconciliation'].includes(result?.state) ? `<label>מזהה הוצאה קיימת לבדיקה מול Morning<input data-expense-field="reconciliationId" data-input="morning-expense-field" value="${esc(reconciliationId)}" ${busy ? 'disabled' : ''}></label><button type="button" class="btn" data-action="morning-expense-write" data-expense-command="reconcile" ${busy ? 'disabled' : ''}>בדיקת התאמה ושחזור</button>` : ''}
      <span>קובץ מקור: ${result?.fileLinked ? fileLabels.file_linked : fileLabels[result?.fileState] || 'טרם אומת'} · אישור ודיווח נבדקים ב־Morning</span></div>` : ''}
      </div><div class="morning-expense-source" data-drop="morning-expense-drop" data-dragover="morning-expense-dragover"><label class="morning-expense-drop">בחירת קובצי מקור · גרירה או הדבקה<input type="file" multiple accept="application/pdf,image/jpeg,image/png" data-change="morning-expense-files" ${busy || fileAttempted || operationId && !result?.verified ? 'disabled' : ''}></label>
      <small>PDF, JPG או PNG עד 20MB לקובץ · הקבצים נשארים בזיכרון עד להעלאה. ${queue.length ? `${queue.length} נוספים בתור` : ''}</small>
      ${selected ? `<ol class="morning-expense-queue" aria-label="תור מסמכי המקור">${[selected, ...queue].map((item, index) => `<li>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="choose-file" data-expense-index="${index}" aria-pressed="${index === 0}" ${disabled || fileAttempted ? 'disabled' : ''}>${esc(item.name)}</button>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="remove-file" data-expense-index="${index}" aria-label="הסרת ${esc(item.name)} מהתור" ${disabled || fileAttempted ? 'disabled' : ''}>הסרה</button></li>`).join('')}</ol>` : ''}
      ${selected ? `<b>${esc(selected.name)}</b>${selected.type === 'application/pdf' ? `<iframe src="${esc(previewUrl)}" title="חשבונית מקור לבדיקה"></iframe>` : `<img src="${esc(previewUrl)}" alt="חשבונית מקור לבדיקה">`}` : '<p>בחר קובץ להצגתו לצד השדות.</p>'}
      ${result?.verified ? `<button type="button" class="btn" data-action="morning-expense-upload" ${busy || fileAttempted || !selected || !catalog.capabilities.upload || result.fileLinked ? 'disabled' : ''}>העלאת הקובץ ל־Morning</button><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="file-status" ${busy ? 'disabled' : ''}>בדיקת קישור הקובץ</button>` : ''}</div></div>` : ''}</div>` : ''}</section>`;
  }
  const commands = {load, status, next, search:supplierSearch, favorite, 'more-classifications':moreClassifications,
    'classification-year':classificationYear,
    'use-favorite':element => setField({dataset:{expenseField:'supplierId'}, value:element.dataset.expenseSupplier}),
    'choose-file':queueChange, 'remove-file':queueChange, 'file-status':fileStatus};
  const writes = {cancel:() => recover('cancel_reserved'), reconcile:() => recover('reconcile')};
  const actions = {
    'morning-expense-toggle':() => { if (busy) return false; expanded = !expanded; render(); return true; },
    'morning-expense-command':element => Object.hasOwn(commands, element.dataset.expenseCommand) ? commands[element.dataset.expenseCommand](element) : false,
    'morning-expense-write':element => Object.hasOwn(writes, element.dataset.expenseCommand) ? writes[element.dataset.expenseCommand]() : false,
    'morning-expense-field':setField,
    'morning-expense-save':save,
    'morning-expense-upload':upload,
    'morning-expense-files':element => chooseFiles(element.files),
    'morning-expense-dragover':(_, event) => event.preventDefault(),
    'morning-expense-drop':(_, event) => { event.preventDefault(); return chooseFiles(event.dataTransfer?.files || []); },
    'morning-expense-keyboard':(_, event) => {if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); return save();} return false;},
    'morning-expense-paste':(_, event) => {if (!event.clipboardData?.files.length) return false; event.preventDefault(); return chooseFiles(event.clipboardData.files);},
  };
  return {markup, actions, runtime:{isPending:tasks.isPending, drain:tasks.drain, dispose:() => {if (!tasks.close()) return false; clear(); unsubscribe(); return true;}}};
}
