import {createExpenseFieldReview, replaceExpenseSurface, expenseSanityMessage, stateLabels, fileLabels, expenseQueueMarkup} from './morning-expense-review-view.js';
import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {expenseAmountChange} from '../../core/morning-expense-amounts.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {readExpenseCatalog, readExpenseCatalogPage, searchExpenseSuppliers, expenseCatalogClassifications, expenseSupplierEligibility} from './morning-expense-catalog.js';
import {readExpenseProposal, expenseProposalFields} from './morning-expense-proposal.js';
import {readExpensePreferences, writeExpensePreferences} from './morning-expense-preferences.js';
import {createExpenseReporting, expenseReportingStorageWarning} from './morning-expense-reporting.js';
import {readExpenseRecovery, writeExpenseRecovery, clearExpenseRecovery} from './morning-expense-recovery.js';
import {createExpenseSupplierPicker} from './morning-expense-supplier-picker.js';
import {createExpenseHistory} from './morning-expense-history.js';
import {createExpenseRecent} from './morning-expense-recent.js';
import {createExpenseRecentCache} from './morning-expense-recent-cache.js';
import {createExpenseFileQueue} from './morning-expense-file-queue.js';
import {createExpenseOcrReview, ocrFileHash} from './morning-expense-ocr.js';
import {createExpenseLocalReview, applyExpenseLocalProposal} from './morning-expense-local.js';
import {createExpensePdfPreview} from './morning-expense-pdf-preview.js';
import {createExpenseSourceSupport} from './morning-expense-source.js';
import {completeExpenseSource} from './morning-expense-completion.js';
import {approveExpenseDraft,approveSourceRetry} from './morning-expense-submit.js';
import {createExpenseProgress} from './morning-expense-progress.js';
import {openExpenseDocument} from './morning-expense-document.js';

const environmentChangedMessage = 'סביבת Morning השתנתה. המסך ננעל והטיוטה נשמרה בסביבתה; יש לפתוח מחדש את מסך ההוצאות לפני עבודה בסביבה החדשה.';

export function createMorningExpenseIntake({request:sendRequest, captureRead, captureWrite, accountId, subscribeAccountScope, confirmDialog, dateEditorMarkup, files, sourceCompletion=completeExpenseSource, todayISO = checkTodayISO, isActive = () => true, onBack = () => false}) {
  const tasks = createRuntimeTaskOwner();
  const recentCache = createExpenseRecentCache();
  const fileQueue = createExpenseFileQueue({validate:files.validate, hash:ocrFileHash});
  const reporting = createExpenseReporting({storage:() => localStorage, todayISO});
  let environmentChanged = false;
  let expanded = false, catalog = null, busy = false, generation = 0, reading = null, message = '', result = null, operationId = '', fileAttempted = false;
  let queue = [], selected = null, previewUrl = '', reconciliationId = '', favorites = [], extraExpenses = [], preferences = null, lastAmountField = '', draft = defaults();
  let editVersion = 0,sourceReason='',fileNotice='';
  let edited = false,advanceReady=false,completionNotice='';
  const workDrafts = new Map();
  const hasValues = (values=draft) => ['number','net','vat','gross','description','allocationNumber'].some(key=>!!values[key]);
  function rememberWork() {
    if(!selected||operationId)return;
    workDrafts.set(selected,{draft:structuredClone(draft),lastAmountField,edited,local:local.snapshot(),
      supplier:catalog?.suppliers.find(row=>row.id===draft.supplierId),classification:sourceExpenses().find(row=>row.id===draft.classificationExpenseId)});
  }
  function hasUnsavedWork(){return queue.length>0||!!operationId&&busy||!operationId&&(!!selected||edited||hasValues());}
  function beforeUnload(event){if(active()&&hasUnsavedWork()){event.preventDefault();event.returnValue='';}}
  globalThis.addEventListener?.('beforeunload',beforeUnload);
  function defaults(previous = {}) {
    const today = todayISO();
    return {supplierId:previous.supplierId || '', classificationExpenseId:previous.classificationExpenseId || '', documentType:305, number:'',
      date:today, ...reporting.fields(today),
      net:'', vat:'', gross:'', description:'', allocationNumber:'', pcnClassification:previous.pcnClassification || 'T'};
  }
  const host = () => document.querySelector('[data-morning-expense-intake]');
  const active = () => tasks.isActive() && isActive();
  const progress=createExpenseProgress({host,isActive:active});
  const stageProgress=(stage,text)=>{progress.show(stage,text);updateMessage(text);};
  function capture(write = false) {
    const check = write ? captureWrite() : captureRead(), epoch = generation;
    return () => { check(); if (!active() || generation !== epoch) throw new Error('פעולת ההוצאות שייכת למסך או להתחברות קודמים.'); };
  }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  async function request(action, payload, check, options) {
    const expectedEnvironment = payload?.expectedEnvironment || (['create', 'operation_status', 'reconcile', 'cancel_reserved','duplicate_check','source_pending','source_waive','source_verify', 'upload_source','upload_prepare', 'upload_ticket', 'upload_ack', 'upload_status'].includes(action) ? catalog?.capabilities.environment : undefined);
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
    progress.reset();
    environmentChanged = false; fileQueue.reset(); sources.reset();workDrafts.clear();edited=false;advanceReady=false;completionNotice='';sourceReason='';fileNotice='';
    local.reset(); pdfPreview.reset(); editVersion++;
    reading?.abort(); reading = null; generation++; catalog = null; busy = false; message = ''; result = null; operationId = ''; fileAttempted = false;
    supplierPicker.reset(); history.reset(); recent.reset(); ocr.reset(); reporting.reset(); queue = []; selected = null; reconciliationId = ''; lastAmountField = ''; favorites = []; extraExpenses = []; preferences = null; releasePreview(); draft = defaults();
  }
  const supplierPicker = createExpenseSupplierPicker({
    rows:() => catalog?.suppliers || [], selectedId:() => draft.supplierId,
    eligibility:eligibilityFor, editable:() => active() && !!catalog && !busy && !operationId && !environmentChanged,
    choose:id => setField({dataset:{expenseField:'supplierId'}, value:id}), run:tasks.run, report:updateMessage,
    invalidateSelection:() => {
      editVersion++; edited=true; local.edited('supplierId');
      draft.supplierId = ''; draft.classificationExpenseId = '';
      for (const key of ['supplierId', 'classificationExpenseId']) {const field = host()?.querySelector(`[data-expense-field="${key}"]`); if (field) field.value = '';}
      const button = host()?.querySelector('[data-action="morning-expense-save"]'); if (button) button.disabled = true;
      review.update();
    },
    search:(query, more, signal) => searchExpenseSuppliers(request, catalog, query, more, capture(), {signal}),
    commit:value => {catalog.suppliers = mergeSuppliers(value.items, catalog.suppliers);},
  });
  const history = createExpenseHistory({request, capabilities:() => environmentChanged ? null : catalog?.capabilities, capture, run:tasks.run, todayISO});
  const recent = createExpenseRecent({request, capabilities:() => environmentChanged ? null : catalog?.capabilities, capture, run:tasks.run, accountId, cache:recentCache});
  const ocr = createExpenseOcrReview({request, capture, run, capabilities:() => catalog?.capabilities, accountId, selected:() => selected,
    files, confirmDialog, apply:applyOcr, advance:() => {if (operationId) return; workDrafts.delete(selected); draft=defaults(); edited=false; selectNextFile({saveCurrent:false});},
    busy:() => busy, canStart:() => !operationId && !environmentChanged});
  const local = createExpenseLocalReview({files, request, capture, capabilities:() => catalog?.capabilities, selected:() => selected,
    editVersion:() => editVersion, onProposal:proposal => pdfPreview.setFields(proposal?.fields),
    onReady:() => {if (!host()?.contains(document.activeElement)) review.focus();},
    apply:(proposal, check) => applyExpenseLocalProposal(proposal, check, applySuggestions), render, run:tasks.run, canStart:() => !!catalog && !operationId && !environmentChanged, canApply:() => !busy && !operationId && !environmentChanged, ocrActive:ocr.active, confirmDialog});
  const pdfPreview = createExpensePdfPreview({capture,run:tasks.run,isActive:active});
  const sources=createExpenseSourceSupport({files,request,capture,run:tasks.run,capabilities:()=>catalog?.capabilities,
    selected:()=>selected,proposal:local.snapshot,confirmDialog,isActive:active,isBusy:()=>busy});
  const unsubscribe = subscribeAccountScope(() => { clear(); render(); });
  function render() {
    if (!active()) return;
    const target = host(); if (!target) return;
    replaceExpenseSurface(target, markup(), () => {review.update(); history.bind();});
  }
  function updateMessage(value) { message = value; const output = host()?.querySelector('[data-expense-message]'); if (output) output.textContent = value; }
  function run(work) {
    if (busy || !active() || environmentChanged) return false;
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
      finally { if (generation === epoch && active()) {
        progress.reset();busy=false;
        if(advanceReady){advanceReady=false;const notice=message;if(next())message=notice+' '+(selected?'החשבונית הבאה מוכנה לבדיקה.':'כל החשבוניות בתור הושלמו.');}
        render();
      } }
    });
  }
  function load() {
    const cachedLocal=local.snapshot();
    local.reset(true);
    return run(async () => {
      const check = capture(), controller = new AbortController(); reading = controller;
      const loaded = await readExpenseCatalog(request, check, todayISO(), {signal:controller.signal}); check();
      if (catalog && catalog.capabilities.environment !== loaded.capabilities.environment) {
        environmentChanged = true; history.reset(); recent.reset(); sources.reset();
        throw new Error(environmentChangedMessage);
      }
      const restorePeriod = !catalog || catalog.capabilities.environment !== loaded.capabilities.environment;
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
      reading = null; message = '';
      if (restorePeriod) {
        if (!reporting.restore(accountId(), loaded.capabilities.environment)) message = expenseReportingStorageWarning;
        Object.assign(draft, reporting.fields(draft.date));
      }
      if (draft.classificationExpenseId && !loaded.expenses.some(row => row.id === draft.classificationExpenseId)) {
        draft.classificationExpenseId = ''; message = 'ההצעות רועננו. יש לבחור שוב את סיווג ההוצאה לפני שמירה.';
      }
      if (!operationId) restore();
      await ocr.initialize(check); check();
      await sources.refresh();check();
      if (selected && !operationId && !ocr.active()) local.restore(cachedLocal);
      recent.loadSite();
      history.refresh();
    });
  }
  function chooseReportingPeriod(key) {
    if (!catalog) return false;
    let choice;
    try {choice = reporting.choose(key, draft.date);} catch {updateMessage('יש לבחור תקופת דיווח תקינה.'); return false;}
    const {saved, ...fields} = choice; Object.assign(draft, fields); editVersion++;
    render(); updateMessage(saved ? 'תקופת הדיווח נשמרה לפתיחות הבאות ותשתנה רק בבחירה ידנית.' : expenseReportingStorageWarning);
    updateSanity(); return true;
  }
  function setField(element) {
    if(!busy&&element.dataset.expenseField==='sourceReason'){sourceReason=element.value.slice(0,250);return true;}
    if (!busy && element.dataset.expenseField === 'reconciliationId') {reconciliationId = element.value; return true;}
    if (busy || operationId || environmentChanged) return false;
    const name = element.dataset.expenseField;
    if(name==='reportingYear'){
      try {return chooseReportingPeriod(reporting.yearKey(element.value));} catch {return false;}
    }
    if (name === 'reportingPeriod') return chooseReportingPeriod(element.value);
    if (!Object.hasOwn(draft, name)) return false;
    editVersion++; edited=true; local.edited(name);
    if (local.blocked()) {const button = host()?.querySelector('[data-action="morning-expense-save"]'); if (button) button.disabled = true;}
    draft[name] = name === 'documentType' ? Number(element.value) : element.value;
    if (name === 'date') {
      try {
        Object.assign(draft, reporting.fields(draft.date));
        const hidden = host()?.querySelector('[data-expense-field="reportingDate"]');
        if (hidden) hidden.value = draft.reportingDate;
        updateMessage('הפרטים טרם נשמרו. חודש הדיווח מותאם אוטומטית לתאריך ולתקופה שבחרת.');
      } catch {updateMessage('יש לבחור תאריך מסמך ותקופת דיווח תקינים.');}
      updateSanity(); review.update(); return true;
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
    updateSanity(); review.update(); return true;
  }
  const sanityMessage = () => expenseSanityMessage(draft, vatRate());
  function updateSanity(){const target=host()?.querySelector('[data-expense-sanity]');if(target){const text=sanityMessage();target.textContent=text;target.hidden=!text;}}
  function vatRate() {return draft.pcnClassification === 'P' ? 16 : 18;}
  function eligibilityFor(supplier) {return expenseSupplierEligibility(supplier, catalog?.capabilities.pSuppliers, catalog?.capabilities.pcnP === true);}
  function calculate(name) {
    const calculated = expenseAmountChange(draft, name, vatRate());
    Object.assign(draft, calculated);
    for (const [field, value] of Object.entries(calculated)) {
      local.edited(field, true);
      const input = host()?.querySelector(`[data-expense-field="${field}"]`); if (input) input.value = value;
    }
  }
  async function chooseFiles(selection) {
    if (busy || operationId && !result?.verified || fileAttempted&&!result?.sourcePending) return false;
    return run(async () => {
      const check = capture(), list = Array.from(selection);
      if (!list.length) return false; fileNotice = '';
      if(operationId){
        if(list.length!==1)throw Error('לפעולה קיימת יש לבחור מחדש קובץ מקור אחד בלבד.');
        const validated = [await files.validate(list[0])]; check();
        if (queue.length >= 20 || queue.reduce((sum, item) => sum + item.file.size, validated[0].file.size) > 100 * 1024 * 1024) {
          throw new Error('ניתן לשמור בתור עד 20 קבצים ובסך הכול עד 100MB.');
        }
        workDrafts.delete(selected);local.reset();releasePreview();selected=validated[0];
        if(selected.type!=='application/pdf')previewUrl=URL.createObjectURL(selected.file);pdfPreview.select(selected);
        message='המקור נבחר לבדיקה מול ההוצאה הקיימת. לא תיווצר הוצאה נוספת.';
        await completeCurrent(check);return true;
      }
      const existing = [...(selected ? [selected] : []), ...queue];
      const {accepted, duplicates} = await fileQueue.prepare(list, existing, check); check();
      queue.push(...accepted); if (!selected && accepted.length) selectNextFile({preserveDraft:edited||hasValues()});
      message = accepted.length ? 'הקבצים נוספו לתור. טיוטות העבודה נשמרות בזיכרון עד לסגירת המסך.' : '';
      if (duplicates.length) fileNotice = `עותק זהה של ${duplicates[0].name} כבר נוסף לתור ולא נוסף שוב${duplicates.length>1?' · '+duplicates.length+' עותקים זהים':''}.`;

    });
  }
  function selectNextFile({saveCurrent=true,preserveDraft=false,carryPreferences=false}={}) {
    fileNotice = "";
    if(saveCurrent)rememberWork();
    const preferencesDraft=draft;
    local.reset(preserveDraft); editVersion++;
    releasePreview(); selected = queue.shift() || null;
    if (selected && selected.type !== 'application/pdf') previewUrl = URL.createObjectURL(selected.file);
    pdfPreview.select(selected);
    if (!operationId) {
      let saved=workDrafts.get(selected);
      if(carryPreferences&&saved&&!saved.edited&&!hasValues(saved.draft))saved=null;
      if(saved){
        draft=structuredClone(saved.draft);lastAmountField=saved.lastAmountField;edited=saved.edited;
        if(saved.supplier)catalog.suppliers=mergeSuppliers([saved.supplier],catalog.suppliers);
        if(saved.classification&&!sourceExpenses().some(row=>row.id===saved.classification.id))extraExpenses.push(saved.classification);
        catalog.classifications=expenseCatalogClassifications(sourceExpenses());
      }else if(!preserveDraft){draft=defaults(carryPreferences?preferencesDraft:{});lastAmountField='';edited=false;}
      Object.assign(draft, reporting.fields(draft.date));
      supplierPicker.reset();
      if(local.available()){if(saved)local.restore(saved.local);else local.start({autoFill:!preserveDraft});}
    }
  }
  function save() {
    if (environmentChanged) {updateMessage(environmentChangedMessage); return false;}
    if (ocr.active()) {updateMessage('המסמך שייך לטיוטת OCR. יש להשלים את האישור במורנינג; יצירת הוצאה נפרדת חסומה למניעת כפילות.'); return false;}
    if (local.blocked()) {updateMessage('יש להמתין להשלמת הזיהוי ובדיקת הטיוטות הקודמות לפני שמירה.'); return false;}
    if (!busy && !operationId) {
      const dateInput = host()?.querySelector('[data-expense-field="date"]');
      if (dateInput) draft.date = dateInput.value;
    }
    return run(async () => {
      const check = capture(true);
      if (!catalog?.capabilities.create || operationId) throw new Error('שמירה אינה זמינה לפעולה זו.');
      if (selected && !catalog.capabilities.upload) throw new Error('צירוף קבצים עדיין כבוי בחשבון זה. אין לשמור הוצאה עם קובץ בתור עד להפעלתו.');
      if(selected&&catalog.capabilities.environment==='production'&&!catalog.capabilities.sourceRelay)throw Error('יש לרענן את המסך לאחר עדכון שירות צירוף המקור.');
      const eligibility = eligibilityFor(catalog.suppliers.find(row => row.id === draft.supplierId));
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      if (draft.pcnClassification === 'P' && !eligibility.p) throw new Error('קליטת P זמינה רק לשני הספקים שהוגדרו ואומתו.');
      const nextId=crypto.randomUUID(),surface=host();
      const approved=await approveExpenseDraft({draft,operationId:nextId,today:todayISO(),capabilities:catalog.capabilities,
        supplier:catalog.suppliers.find(row=>row.id===draft.supplierId),classification:sourceExpenses().find(row=>row.id===draft.classificationExpenseId)?.classification,
        confirmDialog,check,currentSurface:()=>surface?.isConnected&&host()===surface,preflight:local.preflight,prepareSource:sources.prepare,
        verifySource:local.verifySource,request,progress:stageProgress});
      if(!approved)return false;const {snapshot,source}=approved;
      local.approve(snapshot.number);
      operationId = nextId; result = {state:'pending', verified:false}; remember();
      stageProgress('create','שומר את ההוצאה במורנינג ומאמת את פרטיה…');
      try{result = await request('create', {operationId, expense:snapshot,...(source?{sourceFile:source.sourceFile,sourceReview:source.sourceReview}:{})}, check);check();}
      catch(error){
        check();if(error.details?.notDispatched===true){clearExpenseRecovery(localStorage,accountId(),catalog.capabilities.environment);operationId='';result=null;}
        throw error;
      }
      if (result.verified) rememberClassification(snapshot.supplierId, snapshot.classificationExpenseId);
      if (result.verified) {recent.record(result); history.refresh();}
      if(result.verified)await completeCurrent(check);
      else message='השליחה טרם אומתה. נשארנו בחשבונית זו; יש לבדוק מצב ואין לשמור שוב.';
      await sources.refresh();check();
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
      await sources.refresh();check();
      if(result.verified)await completeCurrent(check);
      else message=result.state === 'not_found' ? 'השרת אישר שמזהה הפעולה אינו קיים. ניתן להתחיל קליטה חדשה.' : 'הפעולה עדיין דורשת בדיקה ב־Morning. אין ליצור את אותה חשבונית שוב.';
    });
  }
  async function completeCurrent(check,retryGeneration=''){
    if(!operationId||!result?.verified)return false;
    const id=operationId,source=selected;
    const current=()=>{check();if(id!==operationId||source!==selected)throw Error('פעולת המקור התחלפה.');};
    const prepared=source?await sources.prepareOperation(result,current):null;current();
    const completed=await sourceCompletion({request:(action,body,guard)=>request(action,{operationId:id,...body},guard),
      upload:files.upload,prepare:async guard=>{guard();return prepared;},selected:source,result,attempted:fileAttempted,
      markAttempted:()=>{current();fileAttempted=true;},accept:value=>{current();result=value;if(['not_started','prepared'].includes(value.fileState))fileAttempted=false;},check:current,
      progress:(text,stage='verify')=>stageProgress(stage,text),uploadEnabled:catalog.capabilities.upload,relay:catalog.capabilities.sourceRelay,retryGeneration});current();
    if(completed){
      advanceReady=true;message='ההוצאה נשמרה ואומתה'+(source?' עם מסמך המקור':'')+'.';
      completionNotice=`נשמרה: ${result.intent?.supplierName||''} · ${result.intent?.number||draft.number} · ${message}`;
    }
    await sources.refresh();check();return completed;
  }
  function upload(){return run(()=>completeCurrent(capture(true)));}
  function fileStatus() {
    return run(async () => {
      const check = capture();
      return completeCurrent(check);
    });
  }
  function retrySource(){return run(async()=>{
    const check=capture(true);stageProgress('verify','בודק את מצב המקור הקודם…');
    const value=await approveSourceRetry({request,operationId,check,selected,confirmDialog});
    if(value){result=value.result;return completeCurrent(check,value.retryGeneration);}
  });}
  function sourceVerify(){
    return run(async()=>{
      const check=capture();if(!result?.verified||!selected)throw Error('יש לקרוא את ההוצאה ולבחור את המקור המקורי לבדיקה.');
      const source=await sources.prepareOperation(result,check);check();
      const value=await request('source_verify',{operationId,contentType:selected.type,size:selected.file.size,...source},check);check();
      result={...result,...value};await completeCurrent(check);
    });
  }
  function sourceWaive(){
    return run(async()=>{
      const check=capture(true),reason=sourceReason.trim();
      if(!result?.verified||!result.sourcePending||reason.length<10)throw Error('יש לפרט סיבה בת 10 תווים לפחות לטיפול בחריגה ממסמך המקור.');
      const approved=await confirmDialog('תיעוד חריגה במקור החשבונית',
        'לא תאומת התאמת הקובץ. הסיבה תישמר ביומן, ההוצאה במורנינג לא תשתנה והעלאה קודמת לא תבוטל או תישלח שוב. האם להמשיך?',{confirmText:'תעד את החריגה'});
      check();if(!approved)return false;
      const value=await request('source_waive',{operationId,reason},check);check();result={...result,...value};message=value.message;await sources.refresh();check();
    });
  }
  function sourceResume(element){
    return run(async()=>{
      const id=element.dataset.sourceOperation,check=capture();
      if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return false;
      if(operationId&&operationId!==id){
        message='חשבונית אחרת עדיין פתוחה להשלמה. יש להשלים אותה או לתעד חריגה לפני פתיחת חשבונית זו.';return false;
      }
      if(!operationId){
        rememberWork();if(selected)queue.unshift(selected);selected=null;local.reset();pdfPreview.reset();releasePreview();
        operationId=id;result={state:'needs_reconciliation',verified:false};remember();
      }
      result=await request('operation_status',{operationId},check);check();
      fileAttempted=!['not_started','prepared'].includes(result.fileState);sourceReason='';
      message='פרטי הפעולה נקראו מהשרת. בודק את המקור שכבר נשלח…';render();
      host()?.querySelector('[data-expense-message]')?.scrollIntoView({block:'nearest'});
      if(result.verified)await completeCurrent(check);
      else message='פעולת היצירה עדיין דורשת בירור. לא נוצרה הוצאה נוספת.';
    });
  }
  function next() {
    if (ocr.active()) {updateMessage('יש לסמן את סריקת ה־OCR במפורש כממתינה לפני מעבר לקובץ הבא.'); return false;}
    if (busy || operationId && !result?.verified && !['not_found', 'cancelled'].includes(result?.state)) return false;
    const filePending = result?.fileState && !['not_started', 'prepared'].includes(result.fileState);
    if(operationId&&result?.verified&&(result.sourcePending||!result.sourceException&&(selected||filePending)&&!result.fileLinked)){
      updateMessage('יש להשלים את אימות המקור, או לתעד חריגה מפורשת, לפני המעבר לחשבונית הבאה.');return false;
    }
    if (operationId) { try { clearExpenseRecovery(localStorage, accountId(), catalog.capabilities.environment); } catch { updateMessage('לא ניתן לנקות את מזהה הפעולה.'); return false; } }
    const completed = result?.verified;
    if(completed)workDrafts.delete(selected);
    supplierPicker.reset(); operationId = ''; result = null; fileAttempted = false; reconciliationId = ''; lastAmountField = ''; draft = defaults(draft);
    edited=false;sourceReason='';if (completed) selectNextFile({saveCurrent:false,carryPreferences:true}); message = 'מוכן לחשבונית הבאה.'; render(); return true;
  }
  function mergeSuppliers(found, retained = []) {
    return [...new Map([...favorites, ...retained, ...found].map(row => [row.id, row])).values()];
  }
  function sourceExpenses() {return [...(catalog?.expenses || []), ...extraExpenses];}
  async function applySuggestions(item, check, origin) {
    if (operationId || item.currency && item.currency !== 'ILS') throw new Error('ניתן למלא את הטופס רק במסמך בשקלים ובהיעדר פעולת יצירה קיימת.');
    const {supplier, category, categoryRows, categoryUnavailable} = await readExpenseProposal(item, {
      request, capabilities:catalog.capabilities, canonicalItem, expenses:sourceExpenses(), local:origin === 'local', check});
    check();
    if (origin !== 'local') draft = defaults();
    // An unrecognized date/type must not silently inherit today's date or the
    // default invoice type. Existing manual entries still survive partial fills.
    else if (!edited) {draft.date = ''; draft.documentType = '';}
    lastAmountField = ''; supplierPicker.reset();
    const suggestions = expenseProposalFields(item, catalog.classifications);
    Object.assign(draft, origin === 'local' ? Object.fromEntries(Object.entries(suggestions).filter(([,value]) => value !== '' && value !== null && value !== undefined)) : suggestions);
    if (supplier) {catalog.suppliers = mergeSuppliers([supplier], catalog.suppliers); draft.supplierId = supplier.id; draft.pcnClassification = eligibilityFor(supplier).p ? 'P' : 'T';}
    if (supplier && origin === 'local') {
      extraExpenses = [...new Map([...extraExpenses, ...categoryRows].map(row => [row.id, row])).values()];
      catalog.classifications = expenseCatalogClassifications(sourceExpenses());
      draft.classificationExpenseId = category?.id || '';
    }
    try {Object.assign(draft, reporting.fields(draft.date));} catch {draft.reportingDate = '';}
    message = supplier ? 'הספק אומת בספריית Morning לפי מספר עוסק ומזהה. יש לבדוק את נתוני החשבונית מול המקור.' : 'הצעות מולאו לבדיקה. זהות הספק לא אומתה; יש לבחור ספק ידנית.';
    if (categoryUnavailable) message += ' היסטוריית הסיווג לא זמינה; יש לבחור סיווג ידנית.';
    return supplier;
  }
  function applyOcr(item, check) {return applySuggestions(item, check, 'ocr');}
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
    const target=[...(selected?[selected]:[]),...queue][index];if(!target)return false;
    const commit=()=>{
      fileNotice = "";
      const items=[...(selected?[selected]:[]),...queue];if(items[index]!==target)return false;
      if(remove&&index>0){items.splice(index,1);queue=items.slice(1);workDrafts.delete(target);}
      else if(!remove&&index===0)return true;
      else{
        if(!remove)rememberWork();
        const [item]=items.splice(index,1);if(!remove)items.unshift(item);else workDrafts.delete(item);
        queue=items;selectNextFile({saveCurrent:false});
      }
      message=remove?'הקובץ וטיוטתו הוסרו מהתור המקומי.':'טיוטת העבודה של הקובץ שוחזרה.';render();return true;
    };
    if(remove&&(target===selected?edited:workDrafts.get(target)?.edited))return run(async()=>{
      const check=capture(),approved=await confirmDialog('מחיקת טיוטת העבודה של הקובץ','התיקונים שהקלדת לקובץ זה יימחקו מהזיכרון. לא תימחק הוצאה ממורנינג.',{confirmText:'הסר את הקובץ והטיוטה'});
      check();return approved?commit():false;
    });
    return commit();
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
      '' : 'חשבון Morning האמיתי · יצירת הוצאות כבויה או אינה מורשית למשתמש זה.';
    else notice = caps.create ? 'סביבת בדיקות Sandbox · יש לבדוק כל פרט מול מסמך המקור.' : 'סביבת Sandbox · שמירה דורשת הרשאה ושתי זהויות ספקי P שאומתו מול Morning.';
    return notice + (caps.create && !caps.upload ? ' צירוף קבצים עדיין כבוי.' : '');
  }
  const review = createExpenseFieldReview({host, visible:() => !!selected || !!local.snapshot().proposal,
    reviewFields:() => local.fieldReview(draft, catalog?.suppliers.find(row => row.id === draft.supplierId)?.taxId),
    warningsMarkup:() => local.warningsMarkup(catalog?.suppliers.find(row => row.id === draft.supplierId)?.taxId, draft)});
  function markup() {
    const disabled = busy || !!operationId || environmentChanged, attrs = disabled ? 'disabled' : '';
    const option = (value, label, current, unavailable = false) => `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''} ${unavailable ? 'disabled' : ''}>${esc(label)}</option>`;

    const {today, year, years, periods} = reporting.choices();
    const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
    const eligibility = eligibilityFor(supplier);
    return `<section class="morning-expense-intake" data-morning-expense-intake data-keydown="morning-expense-keyboard" data-paste="morning-expense-paste" dir="rtl">
      ${expanded ? `<header class="morning-expense-heading"><h1>קליטת הוצאות ב־Morning</h1><button type="button" class="btn" data-action="morning-expense-back">חזרה למאזן ודוחות</button></header>` : `<button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="false"><b>קליטת הוצאות ב־Morning</b><span>←</span></button>`}
      ${expanded&&completionNotice?`<p class="morning-expense-notice" role="status" data-expense-completed>${esc(completionNotice)}</p>`:''}
      ${expanded ? `<div class="morning-expense-content"><div class="morning-expense-toolbar">
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="load" ${busy ? 'disabled' : ''}>${catalog ? 'רענון ספקים וסיווגים' : busy ? 'טוען ספקים וסיווגים…' : 'ניסיון טעינה נוסף'}</button>
      <a href="${catalog?.capabilities.environment === 'sandbox' ? 'https://app.sandbox.d.greeninvoice.co.il' : 'https://app.greeninvoice.co.il'}" target="_blank" rel="noopener noreferrer">פתיחת Morning</a></div>
      ${environmentNotice() ? `<p class="morning-expense-notice">${esc(environmentNotice())}</p>` : ''}${ocr.markup()}
      <p class="morning-expense-status" role="status" aria-live="polite" data-expense-message>${esc(busy ? 'הפעולה מתבצעת…' : message)}</p>
      ${progress.markup()}
      ${catalog ? `<div class="morning-expense-workspace"><div class="morning-expense-fields">
      <h2 class="morning-expense-panel-title">פרטי ההוצאה</h2>
      ${!operationId ? `
      <div class="morning-expense-supplier-row"><div class="morning-expense-supplier-field">${supplierPicker.markup(disabled)}${review.slot('supplierId')}</div>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="favorite" ${disabled || !supplier ? 'disabled' : ''}>${favorites.some(row => row.id === draft.supplierId) ? 'הסרה מהמועדפים' : 'הוספה למועדפים שלי'}</button></div>
      ${supplier && !eligibility.eligible ? `<small>${esc(eligibility.reason)}</small>` : ''}
      ${favorites.length ? `<div class="morning-expense-toolbar">${favorites.map(row => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="use-favorite" data-expense-supplier="${esc(row.id)}" ${attrs}>${esc(row.name)}</button>`).join('')}</div>` : ''}
      <div class="morning-expense-pair morning-expense-classification"><label>סיווג מהוצאות קיימות<select data-expense-field="classificationExpenseId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סיווג', draft.classificationExpenseId)}${catalog.classifications.map(row => option(row.sourceExpenseId, row.title, sourceExpenses().find(item => item.id === draft.classificationExpenseId)?.classification?.id === row.id ? row.sourceExpenseId : '')).join('')}</select></label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="more-classifications" ${disabled || catalog.expensePage.page + 1 >= catalog.expensePage.pages || catalog.expensePage.page >= 19 ? 'disabled' : ''}>חיפוש סיווגים בהוצאות נוספות</button></div>
      <small>הצעות מתוך ${catalog.expenses.length} הוצאות בטווח ${esc(catalog.fromDate)}–${esc(catalog.toDate)}. הרשימה אינה קטלוג מלא. אחוזי ההכרה מנוהלים ב־Morning.</small>
      <div class="morning-expense-reporting"><label>תקופת דיווח מע״מ<select aria-label="שנת דיווח מע״מ" data-expense-field="reportingYear" data-change="morning-expense-field" ${attrs}>${years.map(value=>option(value,value,year)).join('')}</select>
      <select data-expense-field="reportingPeriod" data-change="morning-expense-field" ${attrs}>${periods.map(item => option(item.key, item.label, draft.reportingPeriod)).join('')}</select></label>
      <div class="morning-expense-review-input"><label>סוג מסמך<select data-expense-field="documentType" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סוג מסמך', draft.documentType)}${option(305, 'חשבונית מס', draft.documentType)}${option(330, 'חשבונית זיכוי', draft.documentType)}${option(320, 'חשבונית מס קבלה', draft.documentType)}</select></label>${review.slot('documentType')}</div>
      <label>סוג דיווח<select data-expense-field="pcnClassification" data-change="morning-expense-field" ${attrs}>${option('T', 'רגיל · T', draft.pcnClassification)}${option('P', 'חשבונית P', draft.pcnClassification)}</select></label></div>
      ${draft.pcnClassification === 'P' ? `<p class="morning-expense-notice">${catalog.capabilities.pcnP ? 'חשבונית P: הספק וסיווג P מאומתים בשמירה. המע״מ נשאר לפי מסמך המקור ומספר החשבונית מושלם לתשע ספרות.' : 'חשבונית P: המע״מ נשאר לפי מסמך המקור. קליטת P באתר טרם הופעלה לחשבון זה.'}</p>` : ''}
      <div class="morning-expense-pair morning-expense-invoice">${review.textField('number', draft, disabled)}<div class="morning-expense-date"><span>תאריך החשבונית</span><fieldset ${attrs}>
      ${dateEditorMarkup('morningExpenseDate', draft.date, {label:'תאריך החשבונית', compact:true, maxDate:today,
        change:'morning-expense-field', data:{'expense-field':'date'}})}</fieldset>${review.slot('date')}</div></div>
      <input type="hidden" data-expense-field="reportingDate" value="${esc(draft.reportingDate)}">
      <div class="morning-expense-amounts">${review.textField('net', draft, disabled)}${review.textField('vat', draft, disabled)}${review.textField('gross', draft, disabled)}</div>
      <p class="morning-expense-notice" data-expense-sanity ${sanityMessage()?'':'hidden'}>${esc(sanityMessage())}</p>
      <small>הקלדת סה״כ מחשבת לפני מע״מ ומע״מ לפי ${vatRate()}%. אפשר לתקן לפי מסמך המקור. זיכוי מוקלד בסכומים חיוביים.</small>
      <div class="morning-expense-pair">${review.textField('description', draft, disabled)}${review.textField('allocationNumber', draft, disabled)}</div>
      ${selected ? '<div class="morning-expense-toolbar"><span data-expense-review-count></span><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="review-next">לשדה הבא לבדיקה</button></div>' : ''}
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-save"
        ${disabled || ocr.active() || local.blocked() || !catalog.capabilities.create || !eligibility.eligible || draft.pcnClassification === 'P' && (!catalog.capabilities.pcnP || !eligibility.p) ? 'disabled' : ''}>
        ${ocr.active() ? 'טיוטת OCR · יש לאשר במורנינג' : selected?'שמירת ההוצאה וה־PDF ומעבר לבאה':catalog.capabilities.environment === 'production' ? 'בדיקה ושמירת הוצאה ב־Morning' : 'בדיקה ושמירה ב־Sandbox'}</button></div>
      ${local.warningsMarkup(supplier?.taxId, draft)}` : ''}
      ${operationId ? `<div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="next"
        ${busy||result?.sourcePending||!result?.verified&&!['not_found','cancelled'].includes(result?.state)?'disabled':''}>${queue.length?'לחשבונית הבאה בתור':'קליטת הוצאה נוספת'}</button></div>` : ''}
      ${operationId ? `<div class="morning-expense-operation"><b>${esc(stateLabels[result?.state] || 'מצב הפעולה טרם אומת')}</b><small>מזהה פעולה: <bdi>${esc(operationId)}</bdi></small><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="status" ${busy ? 'disabled' : ''}>בדיקת מצב היצירה</button>
      ${result?.expenseId ? `<small>מזהה הוצאה ב־Morning: <bdi>${esc(result.expenseId)}</bdi></small>` : ''}
      ${result?.intent ? `<p data-expense-receipt><strong>${result.verified ? 'פרטי ההוצאה שאומתו' : 'פרטי הבקשה המקורית'}</strong>
      ${esc(result.intent.supplierName)} · ${result.intent.documentType === 330 ? 'זיכוי' : 'חשבונית'} ${esc(result.intent.number)} · תאריך ${esc(result.intent.date)} · דיווח ${esc(result.intent.reportingDate?.slice(0, 7))} · סה״כ ${esc(result.intent.amount)} ₪ · מע״מ ${esc(result.intent.vat)} ₪</p>` : '<p>פרטי הפעולה ייקראו מיומן השרת בבדיקת מצב. אין להזין את החשבונית מחדש.</p>'}
      ${result?.state === 'reserved' ? `<button type="button" class="btn" data-action="morning-expense-write" data-expense-command="cancel" ${busy ? 'disabled' : ''}>ביטול בטוח לפני שליחה</button>` : ''}
      ${['pending', 'needs_reconciliation'].includes(result?.state) ? `<label>מזהה הוצאה קיימת לבדיקה מול Morning<input data-expense-field="reconciliationId" data-input="morning-expense-field" value="${esc(reconciliationId)}" ${busy ? 'disabled' : ''}></label><button type="button" class="btn" data-action="morning-expense-write" data-expense-command="reconcile" ${busy ? 'disabled' : ''}>בדיקת התאמה ושחזור</button>` : ''}
      <span>קובץ מקור: ${result?.fileLinked ? fileLabels.file_linked : fileLabels[result?.fileState] || 'טרם אומת'} · אישור ודיווח נבדקים ב־Morning</span></div>` : ''}
      ${sources.receipt(result,busy,sourceReason)}
      ${result?.verified&&result.sourcePending&&result.sourceRetryGeneration?`<button type="button" class="btn" data-action="morning-expense-write" data-expense-command="source-retry" ${busy?'disabled':''}>צירוף המקור מחדש לאותה הוצאה</button>`:''}
      </div><div class="morning-expense-source ${selected?'':'morning-expense-source-empty'}" data-drop="morning-expense-drop" data-dragover="morning-expense-dragover">
      <h2 class="morning-expense-panel-title">מסמך המקור</h2>
      <label class="morning-expense-drop ${selected?'compact':''}"><span>בחירת קובצי מקור · גרירה או הדבקה</span>${selected?'':'<span class="morning-expense-drop-hint">בחרו חשבוניות להצגה ולזיהוי לצד הטופס</span>'}<input type="file" aria-label="בחירת קובצי מקור להוצאה" ${operationId?'':'multiple'} accept="application/pdf,image/jpeg,image/png"
        data-change="morning-expense-files" ${busy||environmentChanged||fileAttempted&&!result?.sourcePending||operationId&&!result?.verified?'disabled':''}></label>
      <small>PDF, JPG או PNG עד 20MB לקובץ · הקבצים נשארים בזיכרון עד להעלאה. ${queue.length ? `${queue.length} נוספים בתור` : ''}</small>
      <p class="morning-expense-notice" role="status" data-expense-file-notice ${fileNotice?'':'hidden'}>${esc(fileNotice)}</p>
      ${selected ? `<b>${esc(selected.name)}</b>${selected.type === 'application/pdf' ? pdfPreview.markup() : `<img src="${esc(previewUrl)}" alt="חשבונית מקור לבדיקה">`}` : '<p>בחר קובץ להצגתו לצד השדות.</p>'}
      ${local.markup()}
      ${expenseQueueMarkup(selected, queue, disabled || fileAttempted)}
      ${result?.verified&&result.sourcePending ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="file-status" ${busy?'disabled':''}>המשך בדיקה והשלמת המקור</button>`:''}</div></div>${sources.markup()}${recent.markup()}${history.markup()}` : ''}</div>` : ''}</section>`;
  }
  const commands = {load, status, next, favorite, 'more-classifications':moreClassifications,
    'source-open':element=>tasks.run(()=>openExpenseDocument({id:element.dataset.expenseId,request,check:capture(),environment:catalog.capabilities.environment,report:updateMessage})),
    'source-refresh':()=>sources.refresh(),'source-more':sources.more,'source-resume':sourceResume,'source-verify':sourceVerify,
    'review-next':review.focus, 'review-source':element => pdfPreview.field(element.dataset.reviewSource),
    'pdf-prev':pdfPreview.previous, 'pdf-next':pdfPreview.next,
    'pdf-match-prev':pdfPreview.previousMatch, 'pdf-match-next':pdfPreview.nextMatch, 'pdf-target':pdfPreview.target,
    'pdf-zoom-in':pdfPreview.zoomIn, 'pdf-zoom-out':pdfPreview.zoomOut,
    'local-start':() => busy ? false : local.start(), 'local-fill':() => busy ? false : local.fill(), 'local-defer':deferLocal,
    'ocr-start':async () => {if (busy) return false; local.reset(); const value = await ocr.start(); if (!ocr.active()) local.start(); return value;},
    'ocr-status':ocr.status, 'ocr-fill':ocr.fill, 'ocr-defer':ocr.defer, 'ocr-resume':element => {if (busy) return false; local.reset(); return ocr.resume(element);},
    'history-more':history.more, 'history-refresh':history.refresh, 'history-search':history.search, 'history-search-more':history.searchMore, 'history-search-clear':history.clearSearch, 'recent-refresh':recent.load, 'recent-cancel':recent.cancel,
    'use-favorite':element => setField({dataset:{expenseField:'supplierId'}, value:element.dataset.expenseSupplier}),
    'choose-file':queueChange, 'remove-file':queueChange, 'file-status':fileStatus};
  const writes = {cancel:() => recover('cancel_reserved'), reconcile:() => recover('reconcile'),'source-waive':sourceWaive,'source-retry':retrySource};
  const actions = {
    'morning-expense-toggle':() => {expanded = true; render(); if (catalog) return true; return load();},
    'morning-expense-back':onBack,
    'morning-expense-command':element => Object.hasOwn(commands, element.dataset.expenseCommand) ? commands[element.dataset.expenseCommand](element) : false,
    'morning-expense-write':element => Object.hasOwn(writes, element.dataset.expenseCommand) ? writes[element.dataset.expenseCommand]() : false,
    'morning-expense-field':(element, event) => element.hasAttribute('data-expense-picker') ? supplierPicker.handle(element, event) : setField(element),
    'morning-expense-history-query':element => history.setQuery(element.value),
    'morning-expense-history-filter':element => history.chooseFilter(element),
    'morning-expense-history-search-enter':(_, event) => {event.stopPropagation(); if (event.key === 'Enter' && !event.isComposing) {event.preventDefault(); return history.search();} return false;},
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
      const approved = await confirmDialog('הסרת מסמך מהתור ללא שמירה', 'הקובץ והטיוטה יוסרו מהזיכרון. לא נשמרה הוצאה או משימה להמשך. יש לשמור את המקור ולטפל בו בנפרד.', {confirmText:'הסר ללא שמירה'});
      check(); if (!approved || selected !== source) return false;
      workDrafts.delete(selected);draft = defaults();edited=false;supplierPicker.reset();selectNextFile({saveCurrent:false});
      message = 'הקובץ הוסר מהתור ללא שמירה להמשך. יש לשמור את המקור ולטפל בו בנפרד.';
    });
  }
  return {markup, actions, runtime:{isPending:tasks.isPending, drain:tasks.drain, hasUnsavedWork,dispose:() => {
    local.reset();pdfPreview.reset();if(!tasks.close())return false;globalThis.removeEventListener?.('beforeunload',beforeUnload);clear();recentCache.close();unsubscribe();return true;
  }}};
}
