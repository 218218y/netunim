import {esc} from '../../core/values.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';
import {ocrFileHash} from './morning-expense-ocr.js';

const titles = {supplier:'ספק', invoiceNumber:'מספר חשבונית', documentType:'סוג מסמך', date:'תאריך', net:'לפני מע״מ', vat:'מע״מ', gross:'סה״כ', allocationNumber:'מספר הקצאה', currency:'מטבע'};
const statuses = {verified:'זוהה ואומת במסמך', review:'דורש בדיקה', missing:'לא זוהה'};
const reasons = {computed_net:'מחושב מהסכום הכולל פחות המע״מ המפורש', canonical_supplier_pending:'נדרשת התאמה לספריית הספקים של Morning',
  amounts_inconsistent:'הסכומים אינם מתאימים זה לזה', document_identity_unresolved:'זהות המסמך דורשת בדיקה', supplier_prefix_not_verified:'תחילית המספר טרם אומתה',
  multiple_candidates:'נמצאו כמה ערכים אפשריים'};
export function createExpenseLocalReview({files, request, capabilities, capture, selected, editVersion, onProposal = () => {}, apply, render, run, canStart, ocrActive, confirmDialog}) {
  let controller = null, revision = 0, pending = false, proposal = null, guard = false, hash = '', message = '', ocrOperation = '', sourceConflict = false;
  const available = () => !!files?.extract && !!files?.recognize && selected()?.type === 'application/pdf';
  function reset() {controller?.abort(); controller = null; revision++; pending = false; proposal = null; onProposal(null); guard = false; hash = ''; message = ''; ocrOperation = ''; sourceConflict = false;}
  async function lookup(check, signal) {
    if (!capabilities()?.ocrFileGuard) throw new Error('יש לעדכן את שירות ההוצאות לבדיקת טיוטות קודמות לפני שמירה עם PDF.');
    const value = await request('ocr_lookup', {sha256:hash, expectedEnvironment:capabilities().environment}, check, {signal}); check();
    if (typeof value.hasOcrOperation !== 'boolean') throw new Error('לא ניתן לאמת אם קובץ זה כבר נשלח לסריקה.');
    if (value.hasOcrOperation) {
      guard = false; sourceConflict = true; ocrOperation = value.operationId || '';
      throw new Error('לקובץ זה קיימת פעולת OCR. יש להשלים את הבירור והאישור במורנינג; יצירה נפרדת חסומה.');
    }
    guard = true;
  }
  function fill(force = false, expectedVersion = editVersion()) {
    return run(async () => {
      if (!proposal || !available() || !canStart() || ocrActive() || pending) return false;
      const epoch = revision, base = capture();
      const check = () => {base(); if (epoch !== revision || expectedVersion !== editVersion()) throw new Error('הטופס השתנה במהלך הזיהוי. ההצעות זמינות למילוי יזום לאחר בדיקה.');};
      try {
        if (force) {
          const approved = await confirmDialog('מילוי הצעות מה־PDF', 'פרטי החשבונית בטופס יוחלפו בהצעות המקומיות. יש לבדוק את כל השדות מול המסמך.', {confirmText:'מילוי לבדיקה'});
          check(); if (!approved) return false;
        }
        await apply(proposal, check); check(); message = 'הנתונים מולאו בטופס. יש להשוות למקור לפני אישור השמירה.';
        if (!guard) message += ' שמירה עם PDF דורשת עדכון שירות ובדיקת טיוטות קודמות.';
      } catch (error) {if (epoch === revision) message = error.message;}
      if (epoch === revision) render();
    });
  }
  function start({autoFill=true,cached=null}={}) {
    if (!available() || !canStart() || ocrActive()) return false;
    reset(); controller = new AbortController(); pending = true;
    const epoch = revision, source = selected(), version = editVersion(), base = capture(), signal = controller.signal;
    const check = () => {base(); if (epoch !== revision || signal.aborted || selected() !== source) throw new DOMException('Cancelled', 'AbortError');};
    message = 'מזהה מקומית מתוך ה־PDF…'; render();
    return run(async () => {
      try {
        const digest = await ocrFileHash(source.file); check(); hash = digest;
        try {await lookup(check, signal);} catch (error) {check(); message = error.message; if (sourceConflict) throw error;}
        let recognized;
        if(cached?.hash===hash&&cached.proposal)recognized=structuredClone(cached.proposal);
        else {const extracted = await files.extract(source.file, {signal, check}); check(); recognized = await files.recognize(extracted);}
        check(); proposal = recognized; onProposal(recognized);
        pending = false;
        if (!guard) message = 'הזיהוי המקומי הסתיים. שמירה עם PDF דורשת עדכון שירות ובדיקת טיוטות קודמות.';
        if (!autoFill) message='טיוטת העבודה נשמרה. נתוני הזיהוי זמינים להשוואה או למילוי יזום.';
        else if (version === editVersion()) await fill(false, version);
        else message = 'הזיהוי הסתיים בזמן שעריכת הטופס נמשכה. ההצעות זמינות למילוי יזום בלי לדרוס תיקונים.';
      } catch (error) {if (!signal.aborted && epoch === revision) message = ({PasswordException:'ה־PDF מוגן בסיסמה. יש לבחור עותק פתוח או להשלים ידנית.',
        InvalidPDFException:'ה־PDF אינו תקין. יש לבחור עותק תקין או להשלים ידנית.', TimeoutError:'הזיהוי המקומי הגיע למגבלת הזמן. אפשר לנסות שוב או להשלים ידנית.'})[error.name] ||
        (error.message?.startsWith('invoice_pdf_') ? 'ה־PDF חורג ממגבלות העיבוד או אינו ניתן לקריאה. אפשר להשלים ידנית.' : error.message) || 'לא ניתן לחלץ טקסט. אפשר להשלים ידנית או לבחור בסריקת Morning.';}
      finally {if (epoch === revision) {pending = false; render();}}
    });
  }
  async function preflight(snapshot, supplier, check) {
    if (!available()) return;
    if (blocked()) throw new Error('יש להשלים את זיהוי הקובץ ובדיקת הפרטים לפני שמירה.');
    await lookup(check);
    // Prefixes are supplier-specific and verified by the recognizer. Leading
    // zeroes remain in the submitted string. Compare the legacy Roya spelling
    // as an additional read-only duplicate probe, never as a replacement value.
    const numbers = [snapshot.number];
    if (proposal?.profile === 'roya' && proposal.fields.supplier.value === supplier?.taxId && /^0\d+$/.test(snapshot.number)) numbers.push(snapshot.number.replace(/^0+(?=\d)/, ''));
    for (const number of numbers) {
      let total = null, pages = 1; const seen = new Set();
      for (let page = 0; page < pages; page++) {
        const value = await readExpenseCatalogPage(request, capabilities(), 'expenses', {number}, page, check); check();
        if (value.pages > 20 || total !== null && total !== value.total || value.items.some(row => seen.has(row.id))) throw new Error('לא ניתן להשלים בדיקת כפילות. יש לבדוק במורנינג לפני שמירה.');
        total = value.total; pages = value.pages;
        for (const row of value.items) {
          seen.add(row.id);
          if (row.status === 100 || String(row.type) !== String(snapshot.documentType) || row.sourceDocumentDate?.slice(0,4) !== snapshot.date.slice(0,4) || row.number !== number) continue;
          if (row.supplierId === supplier.id || row.supplierTaxId === supplier.taxId || !row.supplierTaxId) throw new Error('נמצאה הוצאה קיימת או מועמדת לכפילות עם מספר זה. יש לבדוק אותה במורנינג; לא נשלחה בקשת יצירה.');
        }
      }
    }
  }
  function blocked() {return available() && (pending || !guard);}
  function warnings(supplierTaxId) {
    if(!proposal)return [];
    const values=[];
    if(!proposal.profile)values.push('הספק או התבנית לא זוהו. יש להשלים לפי המקור.');
    for(const [name,field]of Object.entries(proposal.fields||{})){
      if(field.status==='verified'||name==='supplier'&&field.value===supplierTaxId&&field.reason==='canonical_supplier_pending')continue;
      values.push(`${titles[name]||name}: ${reasons[field.reason]||statuses[field.status]||statuses.review}.`);
    }
    const number=proposal.fields?.invoiceNumber;
    if(number?.rawNumber&&number.rawNumber!==number.suggestedNumber)values.push(`מספר במקור: ${number.rawNumber} · הצעה לשמירה: ${number.suggestedNumber}. הספרות המובילות נשמרו.`);
    if(proposal.allocationPolicy?.status==='check_business_conditions')values.push(proposal.fields.allocationNumber?.value?
      'מספר ההקצאה חולץ מהמסמך. תשע ספרות אינן אימות מול רשות המסים.':
      'לפי התאריך והסכום לפני מע״מ ייתכן שנדרש מספר הקצאה. יש לבדוק ולהשלים לפי תנאי העסקה.');
    return values;
  }
  function warningsMarkup(supplierTaxId){
    const items=warnings(supplierTaxId);
    return `<aside class="morning-expense-notice" data-expense-review-warnings ${items.length?'':'hidden'}>
      <strong>נתוני המקור לבדיקה לפני שמירה</strong><ul>${items.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></aside>`;
  }
  function markup() {
    if (!available() || !canStart() || ocrActive()) return '';
    const fields = proposal?.fields;
    const display = (name, field) => ['net','vat','gross'].includes(name) && Number.isSafeInteger(field.value) ? (field.value / 100).toFixed(2) + ' ₪' : field.value ?? '—';
    return `<section class="morning-expense-local-summary" data-expense-local aria-label="תוצאות הזיהוי המקומי">
      <p role="status" aria-live="polite">${esc(message)}</p>
      ${proposal && !proposal.profile ? '<p>הספק או תבנית המסמך לא זוהו. יש להשלים ידנית לפי המקור.</p>' : ''}
      <details><summary>פרטי הזיהוי המקומי ומקורות הנתונים</summary>
        <p>הזיהוי מתבצע בדפדפן. הקובץ אינו נשלח לסריקה ולא נוצרת טיוטה.</p>
        ${fields ? `<ul>${Object.entries(fields).map(([name, field]) => `<li>
          ${esc(titles[name] || name)}: <bdi>${esc(display(name, field))}</bdi> · ${esc(statuses[field.status] || statuses.review)}
          ${field.sources?.[0]?.page ? ` · עמוד ${field.sources[0].page}` : ''}
          ${reasons[field.reason] ? ` · ${esc(reasons[field.reason])}` : ''}</li>`).join('')}</ul>` : ''}
        ${fields?.invoiceNumber?.rawNumber ? `<small>מספר במקור: <bdi>${esc(fields.invoiceNumber.rawNumber)}</bdi>
          · הצעה: <bdi>${esc(fields.invoiceNumber.suggestedNumber)}</bdi> · המספר הסופי הוא הערך שאישרת בטופס.</small>` : ''}
        ${proposal?.allocationPolicy?.status === 'check_business_conditions' && !fields.allocationNumber.value ?
          '<p>לפי התאריך והסכום במקור ייתכן שנדרש מספר הקצאה. יש לבדוק ולהשלים לפי תנאי העסקה.</p>' : ''}
        <div class="morning-expense-toolbar">
          <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-start" ${pending ? 'disabled' : ''}>זיהוי מחדש</button>
          ${proposal ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-fill" ${pending ? 'disabled' : ''}>מילוי ההצעות מחדש</button>` : ''}
        </div>
      </details>
      ${ocrOperation ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="ocr-resume"
        data-ocr-operation="${esc(ocrOperation)}">בירור סריקת Morning הקיימת</button>` : ''}
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-defer" ${pending ? 'disabled' : ''}>הסרה מהתור ללא שמירה</button>
    </section>`;
  }
  return {start, fill:() => fill(true), reset, markup, preflight, blocked, available,warnings,warningsMarkup,
    snapshot:() => ({proposal:proposal?structuredClone(proposal):null,hash}),
    restore:saved => start({autoFill:false,cached:saved}),
    verifySource:check => available() ? lookup(check) : undefined,
    edited:() => {if (proposal?.fields.invoiceNumber) proposal.fields.invoiceNumber.effectiveNumber = null;},
    approve:number => {if (proposal?.fields.invoiceNumber) proposal.fields.invoiceNumber.effectiveNumber = number;}, pending:() => pending};
}
