import {esc} from '../../core/values.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';
import {ocrFileHash} from './morning-expense-ocr.js';

const titles = {supplier:'ספק', invoiceNumber:'מספר חשבונית', documentType:'סוג מסמך', date:'תאריך', net:'לפני מע״מ', vat:'מע״מ', gross:'סה״כ', allocationNumber:'מספר הקצאה', currency:'מטבע'};
const statuses = {verified:'זוהה ואומת במסמך', review:'דורש בדיקה', missing:'לא זוהה'};
const reasons = {computed_net:'מחושב מהסכום הכולל פחות המע״מ המפורש', canonical_supplier_pending:'נדרשת התאמה לספריית הספקים של Morning',
  amounts_inconsistent:'הסכומים אינם מתאימים זה לזה', document_identity_unresolved:'זהות המסמך דורשת בדיקה', supplier_prefix_not_verified:'תחילית המספר טרם אומתה',
  multiple_candidates:'נמצאו כמה ערכים אפשריים'};
export function createExpenseLocalReview({files, request, capabilities, capture, selected, editVersion, currentNumber = () => '', apply, render, run, canStart, ocrActive, confirmDialog}) {
  let controller = null, revision = 0, pending = false, proposal = null, reviewed = false, guard = false, hash = '', message = '', ocrOperation = '', sourceConflict = false;
  const available = () => !!files?.extract && !!files?.recognize && selected()?.type === 'application/pdf';
  function reset() {controller?.abort(); controller = null; revision++; pending = false; proposal = null; reviewed = false; guard = false; hash = ''; message = ''; ocrOperation = ''; sourceConflict = false;}
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
        await apply(proposal, check); check(); reviewed = false; message = 'ההצעות מולאו. יש לבדוק את השדות מול המקור ולאשר את הבדיקה לפני שמירה.';
        if (!guard) message += ' שמירה עם PDF דורשת עדכון שירות ובדיקת טיוטות קודמות.';
      } catch (error) {if (epoch === revision) message = error.message;}
      if (epoch === revision) render();
    });
  }
  function start() {
    if (!available() || !canStart() || ocrActive()) return false;
    reset(); controller = new AbortController(); pending = true;
    const epoch = revision, source = selected(), version = editVersion(), base = capture(), signal = controller.signal;
    const check = () => {base(); if (epoch !== revision || signal.aborted || selected() !== source) throw new DOMException('Cancelled', 'AbortError');};
    message = 'מזהה מקומית מתוך ה־PDF…'; render();
    return run(async () => {
      try {
        const digest = await ocrFileHash(source.file); check(); hash = digest;
        try {await lookup(check, signal);} catch (error) {check(); message = error.message; if (sourceConflict) throw error;}
        const extracted = await files.extract(source.file, {signal, check}); check();
        const recognized = await files.recognize(extracted); check(); proposal = recognized;
        pending = false;
        if (!guard) message = 'הזיהוי המקומי הסתיים. שמירה עם PDF דורשת עדכון שירות ובדיקת טיוטות קודמות.';
        if (version === editVersion()) await fill(false, version);
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
  function blocked() {return available() && (pending || !guard || !reviewed);}
  function markup() {
    if (!available() || !canStart() || ocrActive()) return '';
    const fields = proposal?.fields;
    const display = (name, field) => ['net','vat','gross'].includes(name) && Number.isSafeInteger(field.value) ? (field.value / 100).toFixed(2) + ' ₪' : field.value ?? '—';
    const reviewFields = fields ? Object.entries(fields).filter(([name, field]) => field.status !== 'verified' && !(name === 'allocationNumber' && !field.value && proposal.allocationPolicy?.status !== 'check_business_conditions')).map(([name]) => titles[name]).filter(Boolean) : [];
    return `<section class="morning-expense-operation" data-expense-local aria-label="זיהוי מקומי מהמסמך">
      <b>זיהוי מקומי מה־PDF</b><p>הטקסט מזוהה בדפדפן. הקובץ אינו נשלח לסריקה ולא נוצרת טיוטה.</p>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-start" ${pending ? 'disabled' : ''}>זיהוי מקומי מחדש</button>
      ${proposal ? `<p>${proposal.profile ? 'המסמך זוהה; כל השדות דורשים בדיקה לפני שמירה.' : 'הספק או תבנית המסמך לא זוהו. יש להשלים ידנית לפי המקור.'}${reviewFields.length ? ' שדות להשלמה או לבדיקה: ' + esc(reviewFields.join(', ')) + '.' : ''}</p><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-fill" ${pending ? 'disabled' : ''}>מילוי ההצעות בטופס</button><details><summary>מקורות השדות והבדיקות</summary><ul>${Object.entries(fields).map(([name, field]) => `<li>${esc(titles[name] || name)}: <bdi>${esc(display(name, field))}</bdi> · ${esc(statuses[field.status] || statuses.review)}${field.sources?.[0]?.page ? ` · עמוד ${field.sources[0].page}` : ''}${reasons[field.reason] ? ` · ${esc(reasons[field.reason])}` : ''}</li>`).join('')}</ul></details>
      ${fields.invoiceNumber?.rawNumber ? `<small>מספר במקור: <bdi>${esc(fields.invoiceNumber.rawNumber)}</bdi> · הצעה: <bdi>${esc(fields.invoiceNumber.suggestedNumber)}</bdi> · המספר הסופי הוא הערך שבדקת בטופס.</small>` : ''}
      ${proposal.allocationPolicy?.status === 'check_business_conditions' ? '<p>לפי התאריך והסכום לפני מע״מ במקור ייתכן שנדרש מספר הקצאה, בכפוף לתנאי העסקה. יש לבדוק את המספר במקור; תשע ספרות אינן אימות מול רשות המסים.</p>' : ''}` : ''}
      ${ocrOperation ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="ocr-resume" data-ocr-operation="${esc(ocrOperation)}">בירור סריקת Morning הקיימת</button>` : ''}
      <p role="status" aria-live="polite">${esc(message)}</p>
      <label><input type="checkbox" data-change="morning-expense-local-review" data-local-reviewed ${reviewed ? 'checked' : ''} ${pending || !guard ? 'disabled' : ''}> בדקתי את הספק, המספר, סוג ותאריך המסמך, הסכומים ומספר ההקצאה מול ה־PDF, והשלמתי שדות חסרים. הסכומים בשקלים.</label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="local-defer" ${pending ? 'disabled' : ''}>סימון כממתין ומעבר לקובץ הבא</button>
      </section>`;
  }
  return {start, fill:() => fill(true), reset, markup, preflight, blocked, available, verifySource:check => available() ? lookup(check) : undefined,
    edited:() => {reviewed = false; if (proposal?.fields.invoiceNumber) proposal.fields.invoiceNumber.effectiveNumber = null;},
    review:element => {reviewed = element.checked === true && guard && !pending;
      if (proposal?.fields.invoiceNumber) proposal.fields.invoiceNumber.effectiveNumber = reviewed ? currentNumber() : null;}, pending:() => pending};
}
