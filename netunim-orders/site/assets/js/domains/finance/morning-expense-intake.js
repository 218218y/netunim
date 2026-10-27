import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeExpenseInput} from '../../core/morning-expense-input.js';
import {expenseAmountChange} from '../../core/morning-expense-amounts.js';
import {expenseBimonth, expenseReportingChoice} from '../../core/morning-report-period.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {readExpenseCatalog, readExpenseCatalogPage, searchExpenseSuppliers, expenseCatalogClassifications, expenseSupplierEligibility} from './morning-expense-catalog.js';
import {readExpensePreferences, writeExpensePreferences} from './morning-expense-preferences.js';
import {readExpenseRecovery, writeExpenseRecovery, clearExpenseRecovery} from './morning-expense-recovery.js';
import {createExpenseSupplierPicker} from './morning-expense-supplier-picker.js';
import {createExpenseHistory} from './morning-expense-history.js';
import {createExpenseRecent} from './morning-expense-recent.js';
import {createExpenseOcrReview} from './morning-expense-ocr.js';
import {createExpenseLocalReview} from './morning-expense-local.js';
import {createExpensePdfPreview} from './morning-expense-pdf-preview.js';

const stateLabels = {reserved:'טרם נשלחה · אפשר לבטל בבטחה', cancelled:'בוטלה לפני שליחה', pending:'נשלחה · טרם אומתה', created_unverified:'נוצרה · אימות הפרטים ממתין', created:'נוצרה והפרטים אומתו', needs_reconciliation:'תוצאה לא ברורה · נדרש בירור ב־Morning', blocked:'הפעולה נחסמה · נדרש בירור'};
const fieldLabels = {number:'מספר חשבונית', date:'תאריך המסמך', net:'לפני מע״מ', vat:'מע״מ מהחשבונית', gross:'כולל מע״מ', description:'תיאור', allocationNumber:'מספר הקצאה, אם נדרש'};
const fileLabels = {not_started:'העלאה טרם התחילה', prepared:'הכנה הושלמה · אפשר להכין מחדש', upload_started:'הנפקת הרשאת העלאה בבדיקה', ticket_issued:'הרשאת העלאה נמסרה · נדרשת בדיקת קישור', file_accepted:'הקובץ התקבל לעיבוד · הקישור טרם אומת', file_linked:'Morning מציגה קובץ מצורף'};
export function createMorningExpenseIntake({request:sendRequest, captureRead, captureWrite, accountId, subscribeAccountScope, confirmDialog, dateEditorMarkup, files, todayISO = checkTodayISO, isActive = () => true, onBack = () => false}) {
  const tasks = createRuntimeTaskOwner();
  let expanded = false, catalog = null, busy = false, generation = 0, reading = null, message = '', result = null, operationId = '', fileAttempted = false;
  let queue = [], selected = null, previewUrl = '', reconciliationId = '', favorites = [], extraExpenses = [], preferences = null, lastAmountField = '', draft = defaults();
  let editVersion = 0;
  function defaults(previous = {}) {
    const today = todayISO();
    return {supplierId:previous.supplierId || '', classificationExpenseId:previous.classificationExpenseId || '', documentType:305, number:'',
      date:today, reportingDate:today.slice(0, 7) + '-01', reportingPeriod:expenseBimonth(today).key,
      net:'', vat:'', gross:'', description:'', allocationNumber:'', pcnClassification:previous.pcnClassification || 'T'};
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
    local.reset(); pdfPreview.reset(); editVersion++;
    reading?.abort(); reading = null; generation++; catalog = null; busy = false; message = ''; result = null; operationId = ''; fileAttempted = false;
    supplierPicker.reset(); history.reset(); recent.reset(); ocr.reset(); queue = []; selected = null; reconciliationId = ''; lastAmountField = ''; favorites = []; extraExpenses = []; preferences = null; releasePreview(); draft = defaults();
  }
  const supplierPicker = createExpenseSupplierPicker({
    rows:() => catalog?.suppliers || [], selectedId:() => draft.supplierId,
    eligibility:eligibilityFor, editable:() => active() && !!catalog && !busy && !operationId,
    choose:id => setField({dataset:{expenseField:'supplierId'}, value:id}), run:tasks.run, report:updateMessage,
    invalidateSelection:() => {
      editVersion++; local.edited();
      draft.supplierId = ''; draft.classificationExpenseId = '';
      for (const key of ['supplierId', 'classificationExpenseId']) {const field = host()?.querySelector(`[data-expense-field="${key}"]`); if (field) field.value = '';}
      const button = host()?.querySelector('[data-action="morning-expense-save"]'); if (button) button.disabled = true;
    },
    search:(query, more, signal) => searchExpenseSuppliers(request, catalog, query, more, capture(), {signal}),
    commit:value => {catalog.suppliers = mergeSuppliers(value.items, catalog.suppliers);},
  });
  const history = createExpenseHistory({request, capabilities:() => catalog?.capabilities, capture, run:tasks.run, todayISO});
  const recent = createExpenseRecent({request, capabilities:() => catalog?.capabilities, capture, run:tasks.run});
  const ocr = createExpenseOcrReview({request, capture, run, capabilities:() => catalog?.capabilities, accountId, selected:() => selected,
    files, confirmDialog, apply:applyOcr, advance:() => {if (operationId) return; supplierPicker.reset(); draft = defaults(); lastAmountField = ''; selectNextFile();}, busy:() => busy, canStart:() => !operationId});
  const local = createExpenseLocalReview({files, request, capture, capabilities:() => catalog?.capabilities, selected:() => selected,
    editVersion:() => editVersion, currentNumber:() => draft.number, apply:applyLocal, render, run:tasks.run, canStart:() => !!catalog && !operationId, ocrActive:ocr.active, confirmDialog});
  const pdfPreview = createExpensePdfPreview({capture,run:tasks.run,isActive:active});
  const unsubscribe = subscribeAccountScope(() => { clear(); render(); });
  function render() {
    if (!active()) return;
    const target = host(); if (!target) return;
    target.outerHTML = markup();
    history.bind();
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
        invalid_expense_p_number:'יש להזין מספר חשבונית P של עד תשע ספרות. אפסים מובילים יושלמו אוטומטית.',
        invalid_expense_reporting_period:'חודש הדיווח חייב להשתייך לתקופה הנבחרת, לא להיות עתידי ולא להקדים את חודש החשבונית.',
        expense_reporting_confirmation_required:'יש לאשר במפורש את השיוך לחודש דיווח מאוחר מחודש החשבונית.',
        morning_expense_p_profiles_unverified:'שתי זהויות ספקי P עדיין לא אומתו מול Morning.',
        morning_expense_p_unverified:'חשבוניות P ייקלטו ב־Morning עד לאימות המסלול.'
      })[error.message] || error.message || 'הפעולה לא הושלמה.'; return false; }
      finally { if (generation === epoch && active()) { busy = false; render(); } }
    });
  }
  function load() {
    local.reset();
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
      supplierPicker.reset(); catalog = loaded; catalog.suppliers = mergeSuppliers(loaded.suppliers, retained);
      reading = null; message = 'נטען עמוד הצעות ראשוני. אפשר לחפש ספקים ולהוסיף סיווגים לפי הצורך.';
      if (draft.classificationExpenseId && !loaded.expenses.some(row => row.id === draft.classificationExpenseId)) {
        draft.classificationExpenseId = ''; message = 'ההצעות רועננו. יש לבחור שוב את סיווג ההוצאה לפני שמירה.';
      }
      if (!operationId) restore();
      await ocr.initialize(check); check();
      if (selected && !operationId && !ocr.active()) local.start();
      recent.record({verified:true});
      history.refresh();
    });
  }
  function setField(element) {
    if (!busy && element.dataset.expenseField === 'reconciliationId') {reconciliationId = element.value; return true;}
    if (busy || operationId) return false;
    const name = element.dataset.expenseField;
    if (!Object.hasOwn(draft, name)) return false;
    editVersion++; local.edited();
    const reviewed = host()?.querySelector('[data-local-reviewed]'); if (reviewed) reviewed.checked = false;
    if (local.blocked()) {const button = host()?.querySelector('[data-action="morning-expense-save"]'); if (button) button.disabled = true;}
    draft[name] = name === 'documentType' ? Number(element.value) : element.value;
    if (['date', 'reportingPeriod'].includes(name)) {
      try {
        draft.reportingDate = expenseReportingChoice(draft.date, draft.reportingPeriod, todayISO()).reportingDate;
        const hidden = host()?.querySelector('[data-expense-field="reportingDate"]');
        if (hidden) hidden.value = draft.reportingDate;
        updateMessage('הפרטים טרם נשמרו. חודש הדיווח מותאם אוטומטית לתאריך ולתקופה שבחרת.');
      } catch {updateMessage('יש לבחור תאריך מסמך ותקופת דיווח תקינים.');}
      return true;
    }
    if (name === 'supplierId') {
      supplierPicker.reset();
      const previousRate = vatRate();
      const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
      const history = catalog?.expenses.filter(row => row.status !== 100 && (row.supplierId === draft.supplierId || supplier?.taxId && row.supplierTaxId === supplier.taxId)).sort((a, b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)));
      const recent = history?.find(row => row.classification?.id);
      draft.classificationExpenseId = recent?.id || '';
      draft.pcnClassification = history?.some(row => row.pcnClassification === 'P') || eligibilityFor(supplier).p ? 'P' : 'T';
      if (previousRate !== vatRate()) calculate(lastAmountField);
      render();
      if (supplier && preferences?.classifications.some(row => row.supplierId === supplier.id)) return restoreClassification(supplier.id);
    } else if (name === 'pcnClassification') {
      if (eligibilityFor(catalog?.suppliers.find(row => row.id === draft.supplierId)).p) draft.pcnClassification = 'P';
      calculate(lastAmountField); render();
    } else if (['net', 'vat', 'gross'].includes(name)) {lastAmountField = name; calculate(name);}
    else updateMessage('הפרטים טרם נשמרו. יש לבדוק מול מסמך המקור.');
    return true;
  }
  function vatRate() {return draft.pcnClassification === 'P' ? 16 : 18;}
  function eligibilityFor(supplier) {return expenseSupplierEligibility(supplier, catalog?.capabilities.pSuppliers, catalog?.capabilities.pcnP === true);}
  function calculate(name) {
    const calculated = expenseAmountChange(draft, name, vatRate());
    Object.assign(draft, calculated);
    for (const [field, value] of Object.entries(calculated)) {
      const input = host()?.querySelector(`[data-expense-field="${field}"]`); if (input) input.value = value;
    }
  }
  async function chooseFiles(selection) {
    if (busy || operationId && !result?.verified || fileAttempted) return false;
    return run(async () => {
      const check = capture(), list = Array.from(selection);
      const existing = [...(selected ? [selected] : []), ...queue];
      if (!list.length || list.length + existing.length > 20 || list.reduce((sum, file) => sum + file.size, existing.reduce((sum, item) => sum + item.file.size, 0)) > 100 * 1024 * 1024) throw new Error('ניתן לבחור עד 20 קבצים ובסך הכול עד 100MB.');
      const validated = [];
      for (const file of list) { validated.push(await files.validate(file)); check(); }
      queue.push(...validated); if (!selected) selectNextFile(); message = 'הקבצים נוספו לתור לבדיקה מול מסמך המקור.';
    });
  }
  function selectNextFile() {
    local.reset(); editVersion++;
    releasePreview(); selected = queue.shift() || null;
    if (selected && selected.type !== 'application/pdf') previewUrl = URL.createObjectURL(selected.file);
    pdfPreview.select(selected);
    if (!operationId && local.available()) {
      const period = draft.reportingPeriod;
      draft = defaults(); draft.reportingPeriod = period; lastAmountField = ''; supplierPicker.reset(); local.start();
    }
  }
  function save() {
    if (ocr.active()) {updateMessage('המסמך שייך לטיוטת OCR. יש להשלים את האישור במורנינג; יצירת הוצאה נפרדת חסומה למניעת כפילות.'); return false;}
    if (local.blocked()) {updateMessage('יש להשלים את בדיקת ה־PDF ולאשר את הפרטים לפני שמירה.'); return false;}
    if (!busy && !operationId) {
      const dateInput = host()?.querySelector('[data-expense-field="date"]');
      if (dateInput) draft.date = dateInput.value;
    }
    return run(async () => {
      const check = capture(true);
      if (!catalog?.capabilities.create || operationId) throw new Error('שמירה אינה זמינה לפעולה זו.');
      if (selected && !catalog.capabilities.upload) throw new Error('צירוף קבצים עדיין כבוי בחשבון זה. אין לשמור הוצאה עם קובץ בתור עד להפעלתו.');
      const eligibility = eligibilityFor(catalog.suppliers.find(row => row.id === draft.supplierId));
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      if (draft.pcnClassification === 'P' && !eligibility.p) throw new Error('קליטת P זמינה רק לשני הספקים שהוגדרו ואומתו.');
      const nextId = crypto.randomUUID(), snapshot = structuredClone(draft);
      const normalized = normalizeExpenseInput({operationId:nextId, expense:snapshot}, todayISO(), {allowP:catalog.capabilities.pcnP === true});
      snapshot.number = normalized.number;
      const classification = sourceExpenses().find(row => row.id === snapshot.classificationExpenseId)?.classification;
      if (!classification?.id) throw new Error('יש לבחור סיווג מתוך ההצעות המוצגות לפני שמירה.');
      const surface = host(), supplier = catalog.suppliers.find(row => row.id === snapshot.supplierId);
      await local.preflight(snapshot, supplier, check); check();
      const typeTitle = {305:'חשבונית מס', 330:'חשבונית זיכוי', 320:'חשבונית מס קבלה'};
      const details = `${supplier?.name || ''} · ${typeTitle[snapshot.documentType]} ${snapshot.number} · תאריך ${snapshot.date} · סיווג ${classification.title}`;
      const amounts = `לפני מע״מ ${snapshot.net} ₪ · מע״מ ${snapshot.vat} ₪ · סה״כ ${snapshot.gross} ₪`;
      const period = `תקופת דיווח ${expenseBimonth(snapshot.reportingDate).label}`;
      const confirmed = await confirmDialog(catalog.capabilities.environment === 'production' ? 'שמירת הוצאה בחשבון Morning האמיתי' : 'שמירת הוצאה ב־Sandbox', `${details} · ${amounts} · ${period}. האם הפרטים תואמים למסמך המקור?`, {confirmText:'שמור ב־Morning'});
      check();
      if (!confirmed || !surface?.isConnected || host() !== surface) return false;
      await local.verifySource(check); check();
      operationId = nextId; result = {state:'pending', verified:false}; remember();
      result = await request('create', {operationId, expense:snapshot}, check); check();
      if (result.verified) rememberClassification(snapshot.supplierId, snapshot.classificationExpenseId);
      if (result.verified) {recent.record(result); history.refresh();}
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
      recent.record(result);
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
    if (ocr.active()) {updateMessage('יש לסמן את סריקת ה־OCR במפורש כממתינה לפני מעבר לקובץ הבא.'); return false;}
    if (busy || operationId && !result?.verified && !['not_found', 'cancelled'].includes(result?.state)) return false;
    const filePending = result?.fileState && !['not_started', 'prepared'].includes(result.fileState);
    if (operationId && result?.verified && (selected || filePending) && !result.fileLinked) { updateMessage('יש לאמת את קישור קובץ המקור לפני המעבר לחשבונית הבאה.'); return false; }
    if (operationId) { try { clearExpenseRecovery(localStorage, accountId(), catalog.capabilities.environment); } catch { updateMessage('לא ניתן לנקות את מזהה הפעולה.'); return false; } }
    const completed = result?.verified;
    supplierPicker.reset(); operationId = ''; result = null; fileAttempted = false; reconciliationId = ''; lastAmountField = ''; draft = defaults(draft);
    if (completed) selectNextFile(); message = 'מוכן לחשבונית הבאה.'; render(); return true;
  }
  function mergeSuppliers(found, retained = []) {
    return [...new Map([...favorites, ...retained, ...found].map(row => [row.id, row])).values()];
  }
  function sourceExpenses() {return [...(catalog?.expenses || []), ...extraExpenses];}
  async function applySuggestions(item, check, origin) {
    if (operationId || item.currency && item.currency !== 'ILS') throw new Error('ניתן למלא את הטופס רק במסמך בשקלים ובהיעדר פעולת יצירה קיימת.');
    let supplier = null;
    const taxId = item.supplier?.taxId;
    if (/^\d{9}$/.test(taxId || '')) {
      const found = await readExpenseCatalogPage(request, catalog.capabilities, 'suppliers', {taxId}, 0, check);
      const exact = found.items.filter(row => row.taxId === taxId && row.active);
      if (exact.length === 1 && found.total === 1) {
        const canonical = await canonicalItem('get_supplier', exact[0].id, check);
        if (canonical.active && canonical.taxId === taxId && (!item.supplier.id || canonical.id === item.supplier.id)) supplier = canonical;
      }
    }
    check();
    const period = draft.reportingPeriod;
    draft = defaults(); draft.reportingPeriod = period; lastAmountField = ''; supplierPicker.reset();
    const money = value => Number.isSafeInteger(value) && value >= 0 ? (value / 100).toFixed(2) : '';
    Object.assign(draft, {number:item.number, documentType:item.documentType || '', date:item.date?.slice(0, 10) || '',
      net:money(item.netCents), vat:money(item.vatCents), gross:money(item.grossCents), description:item.description || '', allocationNumber:item.allocationNumber || '',
      classificationExpenseId:catalog.classifications.find(row => row.id === item.classification?.id)?.sourceExpenseId || ''});
    if (supplier) {catalog.suppliers = mergeSuppliers([supplier], catalog.suppliers); draft.supplierId = supplier.id; draft.pcnClassification = eligibilityFor(supplier).p ? 'P' : 'T';}
    if (supplier && origin === 'local') {
      const category = sourceExpenses().filter(row => row.status !== 100 && row.classification?.id && (row.supplierId === supplier.id || row.supplierTaxId === supplier.taxId)).sort((a,b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)))[0];
      draft.classificationExpenseId = category?.id || '';
    }
    try {draft.reportingDate = expenseReportingChoice(draft.date, draft.reportingPeriod, todayISO()).reportingDate;} catch {draft.reportingDate = '';}
    message = supplier ? 'הספק אומת בספריית Morning לפי מספר עוסק ומזהה. יש לבדוק את נתוני החשבונית מול המקור.' : 'הצעות מולאו לבדיקה. זהות הספק לא אומתה; יש לבחור ספק ידנית.';
    return supplier;
  }
  function applyOcr(item, check) {return applySuggestions(item, check, 'ocr');}
  async function applyLocal(proposal, check) {
    const f = proposal.fields;
    const supplier = await applySuggestions({number:f.invoiceNumber.suggestedNumber || f.invoiceNumber.value || '', documentType:f.documentType.value,
      date:f.date.value, netCents:f.net.value, vatCents:f.vat.value, grossCents:f.gross.value,
      allocationNumber:f.allocationNumber.value, currency:f.currency.value, supplier:{taxId:f.supplier.value}}, check, 'local');
    check();
    if (supplier) Object.assign(f.supplier, {canonicalVerified:true,canonicalId:supplier.id,status:'verified',reason:''});
  }
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
      recent.record(result);
      message = result.cancelled ? 'הפעולה בוטלה לפני שליחה. אפשר להתחיל קליטה חדשה.' : result.verified ? 'ההוצאה הקיימת תואמת לבקשה המקורית ואומתה.' : 'השחזור עדיין דורש בירור ב־Morning.';
    });
  }
  function environmentNotice() {
    const caps = catalog?.capabilities;
    if (!caps) return 'סביבת Morning, הספקים והסיווגים נטענים אוטומטית בפתיחת המסך.';
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
    const year = Number(today.slice(0, 4));
    for (let month = 11; month >= 1; month -= 2) {
      const date = `${year}-${String(month).padStart(2, '0')}-01`;
      if (date <= today) periods.push(expenseBimonth(date));
    }
    const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
    const eligibility = eligibilityFor(supplier);
    return `<section class="morning-expense-intake" data-morning-expense-intake data-keydown="morning-expense-keyboard" data-paste="morning-expense-paste" dir="rtl">
      ${expanded ? `<header class="morning-expense-heading"><h1>קליטת הוצאות ב־Morning</h1><button type="button" class="btn" data-action="morning-expense-back">חזרה למאזן ודוחות</button></header>` : `<button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="false"><b>קליטת הוצאות ב־Morning</b><span>←</span></button>`}
      ${expanded ? `<div class="morning-expense-content"><div class="morning-expense-toolbar">
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="load" ${busy ? 'disabled' : ''}>${catalog ? 'רענון ספקים וסיווגים' : busy ? 'טוען ספקים וסיווגים…' : 'ניסיון טעינה נוסף'}</button>
      <a href="${catalog?.capabilities.environment === 'sandbox' ? 'https://app.sandbox.d.greeninvoice.co.il' : 'https://app.greeninvoice.co.il'}" target="_blank" rel="noopener noreferrer">פתיחת Morning</a></div>
      <p class="morning-expense-notice">${esc(environmentNotice())}</p>${ocr.markup()}
      <p class="morning-expense-status" role="status" aria-live="polite" data-expense-message>${esc(busy ? 'הפעולה מתבצעת…' : message)}</p>
      ${catalog ? `<div class="morning-expense-workspace"><div class="morning-expense-fields">
      ${!operationId ? `
      <div class="morning-expense-supplier-row"><div class="morning-expense-supplier-field">${supplierPicker.markup(disabled)}</div>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="favorite" ${disabled || !supplier ? 'disabled' : ''}>${favorites.some(row => row.id === draft.supplierId) ? 'הסרה מהמועדפים' : 'הוספה למועדפים שלי'}</button></div>
      ${supplier && !eligibility.eligible ? `<small>${esc(eligibility.reason)}</small>` : ''}
      ${favorites.length ? `<div class="morning-expense-toolbar">${favorites.map(row => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="use-favorite" data-expense-supplier="${esc(row.id)}" ${attrs}>${esc(row.name)}</button>`).join('')}</div>` : ''}
      <div class="morning-expense-pair morning-expense-classification"><label>סיווג מהוצאות קיימות<select data-expense-field="classificationExpenseId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סיווג', draft.classificationExpenseId)}${catalog.classifications.map(row => option(row.sourceExpenseId, row.title, sourceExpenses().find(item => item.id === draft.classificationExpenseId)?.classification?.id === row.id ? row.sourceExpenseId : '')).join('')}</select></label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="more-classifications" ${disabled || catalog.expensePage.page + 1 >= catalog.expensePage.pages || catalog.expensePage.page >= 19 ? 'disabled' : ''}>חיפוש סיווגים בהוצאות נוספות</button></div>
      <small>הצעות מתוך ${catalog.expenses.length} הוצאות בטווח ${esc(catalog.fromDate)}–${esc(catalog.toDate)}. הרשימה אינה קטלוג מלא. אחוזי ההכרה מנוהלים ב־Morning.</small>
      <div class="morning-expense-reporting"><label>תקופת דיווח מע״מ<select data-expense-field="reportingPeriod" data-change="morning-expense-field" ${attrs}>${periods.map(item => option(item.key, item.label, draft.reportingPeriod)).join('')}</select></label>
      <label>סוג מסמך<select data-expense-field="documentType" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סוג מסמך', draft.documentType)}${option(305, 'חשבונית מס', draft.documentType)}${option(330, 'חשבונית זיכוי', draft.documentType)}${option(320, 'חשבונית מס קבלה', draft.documentType)}</select></label>
      <label>סוג דיווח<select data-expense-field="pcnClassification" data-change="morning-expense-field" ${attrs}>${option('T', 'רגיל · T', draft.pcnClassification)}${option('P', 'חשבונית P', draft.pcnClassification)}</select></label></div>
      ${draft.pcnClassification === 'P' ? `<p class="morning-expense-notice">${catalog.capabilities.pcnP ? 'חשבונית P: הספק וסיווג P מאומתים בשמירה. המע״מ נשאר לפי מסמך המקור ומספר החשבונית מושלם לתשע ספרות.' : 'חשבונית P: המע״מ נשאר לפי מסמך המקור. קליטת P באתר טרם הופעלה לחשבון זה.'}</p>` : ''}
      <div class="morning-expense-pair morning-expense-invoice">${textField('number')}<div class="morning-expense-date"><span>תאריך החשבונית</span><fieldset ${attrs}>
      ${dateEditorMarkup('morningExpenseDate', draft.date, {label:'תאריך החשבונית', compact:true, maxDate:today,
        change:'morning-expense-field', data:{'expense-field':'date'}})}</fieldset></div></div>
      <input type="hidden" data-expense-field="reportingDate" value="${esc(draft.reportingDate)}">
      <div class="morning-expense-amounts">${textField('net')}${textField('vat')}${textField('gross')}</div>
      <small>הקלדת סה״כ מחשבת לפני מע״מ ומע״מ לפי ${vatRate()}%. אפשר לתקן לפי מסמך המקור. זיכוי מוקלד בסכומים חיוביים.</small>
      <div class="morning-expense-pair">${textField('description')}${textField('allocationNumber')}</div>
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-save" ${disabled || ocr.active() || local.blocked() || !catalog.capabilities.create || !eligibility.eligible || draft.pcnClassification === 'P' && (!catalog.capabilities.pcnP || !eligibility.p) ? 'disabled' : ''}>${ocr.active() ? 'טיוטת OCR · יש לאשר במורנינג' : catalog.capabilities.environment === 'production' ? 'בדיקה ושמירת הוצאה ב־Morning' : 'בדיקה ושמירה ב־Sandbox'}</button></div>` : ''}
      ${operationId ? `<div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="next" ${busy || !result?.verified && !['not_found', 'cancelled'].includes(result?.state) ? 'disabled' : ''}>${queue.length ? 'לחשבונית הבאה בתור' : 'קליטת הוצאה נוספת'}</button></div>` : ''}
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
      ${local.markup()}${selected ? `<b>${esc(selected.name)}</b>${selected.type === 'application/pdf' ? pdfPreview.markup() : `<img src="${esc(previewUrl)}" alt="חשבונית מקור לבדיקה">`}` : '<p>בחר קובץ להצגתו לצד השדות.</p>'}
      ${result?.verified ? `<button type="button" class="btn" data-action="morning-expense-upload" ${busy || fileAttempted || !selected || !catalog.capabilities.upload || result.fileLinked ? 'disabled' : ''}>העלאת הקובץ ל־Morning</button><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="file-status" ${busy ? 'disabled' : ''}>בדיקת קישור הקובץ</button>` : ''}</div></div>${recent.markup()}${history.markup()}` : ''}</div>` : ''}</section>`;
  }
  const commands = {load, status, next, favorite, 'more-classifications':moreClassifications,
    'pdf-prev':pdfPreview.previous, 'pdf-next':pdfPreview.next,
    'local-start':() => busy ? false : local.start(), 'local-fill':() => busy ? false : local.fill(), 'local-defer':deferLocal,
    'ocr-start':async () => {if (busy) return false; local.reset(); const value = await ocr.start(); if (!ocr.active()) local.start(); return value;},
    'ocr-status':ocr.status, 'ocr-fill':ocr.fill, 'ocr-defer':ocr.defer, 'ocr-resume':element => {if (busy) return false; local.reset(); return ocr.resume(element);},
    'history-more':history.more, 'history-refresh':history.refresh, 'recent-refresh':recent.load,
    'use-favorite':element => setField({dataset:{expenseField:'supplierId'}, value:element.dataset.expenseSupplier}),
    'choose-file':queueChange, 'remove-file':queueChange, 'file-status':fileStatus};
  const writes = {cancel:() => recover('cancel_reserved'), reconcile:() => recover('reconcile')};
  const actions = {
    'morning-expense-toggle':() => {expanded = true; render(); if (catalog) return true; return load();},
    'morning-expense-back':onBack,
    'morning-expense-command':element => Object.hasOwn(commands, element.dataset.expenseCommand) ? commands[element.dataset.expenseCommand](element) : false,
    'morning-expense-write':element => Object.hasOwn(writes, element.dataset.expenseCommand) ? writes[element.dataset.expenseCommand]() : false,
    'morning-expense-field':(element, event) => element.hasAttribute('data-expense-picker') ? supplierPicker.handle(element, event) : setField(element),
    'morning-expense-local-review':element => {if (busy || operationId) return false; local.review(element); render(); return true;},
    'morning-expense-save':save,
    'morning-expense-upload':upload,
    'morning-expense-files':element => chooseFiles(element.files),
    'morning-expense-dragover':(_, event) => event.preventDefault(),
    'morning-expense-drop':(_, event) => { event.preventDefault(); return chooseFiles(event.dataTransfer?.files || []); },
    'morning-expense-keyboard':(_, event) => {if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); return save();} return false;},
    'morning-expense-paste':(_, event) => {if (!event.clipboardData?.files.length) return false; event.preventDefault(); return chooseFiles(event.clipboardData.files);},
  };
  function deferLocal() {
    return run(async () => {
      if (operationId || ocr.active() || !selected) return false;
      const check = capture(), source = selected();
      const approved = await confirmDialog('השארת מסמך להשלמה ידנית', 'הקובץ יוסר מהתור המקומי בלבד. לא נשמרה הוצאה. יש לשמור את המקור ולהשלים את הטיפול בו בהמשך.', {confirmText:'סימון כממתין ומעבר'});
      check(); if (!approved || selected !== source) return false;
      draft = defaults(); supplierPicker.reset(); selectNextFile(); message = 'המסמך סומן כממתין; יש להשלים את הטיפול בו בהמשך.';
    });
  }
  return {markup, actions, runtime:{isPending:tasks.isPending, drain:tasks.drain, dispose:() => {local.reset(); pdfPreview.reset(); if (!tasks.close()) return false; clear(); unsubscribe(); return true;}}};
}
