import {esc} from '../../core/values.js';

const uuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const labels = {reserved:'שמורה להעלאה', issuing:'הנפקת הרשאה בבירור', ticket_issued:'העלאה בבירור · אין לשלוח שוב', accepted:'הקובץ התקבל לעיבוד', processing:'ממתין לפענוח', review_required:'דורש בדיקה ואישור במורנינג'};
export const ocrFileHash = async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
export function createExpenseOcrReview({request, capture, run, capabilities, accountId, selected, files, confirmDialog, apply, advance, busy, canStart}) {
  let operationId = '', result = null, item = null, pending = [], message = '';
  const key = () => 'morningExpenseOcrOperation:' + capabilities().environment + ':' + accountId();
  const call = (action, body, check) => request(action, {...body, expectedEnvironment:capabilities().environment}, check);
  function reset() {operationId = ''; result = null; item = null; pending = []; message = '';}
  function remember() {localStorage.setItem(key(), JSON.stringify({version:1, owner:accountId(), environment:capabilities().environment, operationId}));}
  function accept(value) {
    if (value.operationId !== operationId || value.approvalVerified !== false || value.parsingVerified !== false) throw new Error('תשובת OCR אינה תואמת לפעולה המקורית.');
    result = value; item = value.sourceVerified && value.item?.id === value.draftId ? value.item : null;
    message = value.message || 'הקובץ ממתין לבירור. אישור סופי מתבצע במורנינג.';
  }
  async function readStatus(check) {
    try {accept(await call('ocr_status', {operationId}, check)); check();}
    catch (error) {
      check();
      if (error.code !== 'morning_ocr_operation_missing') throw error;
      result = {state:'reserved'}; item = null;
      message = 'השרת אישר שמזהה הסריקה טרם נשמר. אפשר להמשיך את ההעלאה עם אותו מזהה, או לסמן כממתינה ולעבור הלאה.';
    }
  }
  async function initialize(check) {
    // Restore the recovery boundary BEFORE any network request. A failed list
    // must never hide an unresolved OCR operation and reopen ordinary creation.
    if (!operationId) {
      let saved;
      try {saved = JSON.parse(localStorage.getItem(key()) || 'null');} catch { /* no valid pointer */ }
      if (saved?.version === 1 && saved.owner === accountId() && saved.environment === capabilities().environment && uuid(saved.operationId)) operationId = saved.operationId;
    }
    if (!capabilities()?.ocrRecovery) {
      if (operationId) message = 'נמצאה סריקה קודמת. נדרשת גרסת שירות התומכת בשחזור לפני המשך הקליטה.';
      return;
    }
    try {const list = await call('ocr_list', {}, check); check(); pending = Array.isArray(list.items) ? list.items : [];}
    catch {check(); message = 'רשימת הסריקות אינה זמינה כעת. אפשר לנסות שוב ברענון; מזהה פעיל נשמר לשחזור.';}
    if (operationId) {
      item = null;
      try {await readStatus(check);}
      catch {check(); message = 'לא ניתן לאמת כעת את הסריקה הקודמת. מזהה הפעולה נשמר ואין ליצור ממנה הוצאה נפרדת.';}
    }
  }
  function start() {
    return run(async () => {
      const check = capture(true), source = selected();
      if (!canStart() || !capabilities()?.ocr || !source || source.type !== 'application/pdf' || operationId && result?.state !== 'reserved') throw new Error('יש לבחור PDF ולהשלים בירור של סריקות קודמות.');
      const approved = await confirmDialog('סריקה באמצעות Morning Sandbox', 'הקובץ יישלח ליצירת טיוטת OCR. הנתונים ידרשו בדיקה ואישור ידני במורנינג. לא תיווצר הוצאה סופית באתר.', {confirmText:'סריקת PDF'});
      check(); if (!approved) return false;
      const sha256 = await ocrFileHash(source.file); check();
      operationId ||= crypto.randomUUID(); remember(); // No bytes leave before durable recovery metadata.
      const prepared = await call('ocr_prepare', {operationId, size:source.file.size, contentType:source.type, sha256}, check); check();
      if (prepared.operationId !== operationId) {
        if (!uuid(prepared.operationId) || prepared.fileSha256 !== sha256 || prepared.fileSize !== source.file.size) throw new Error('הפעולה הקודמת אינה תואמת לקובץ שנבחר.');
        operationId = prepared.operationId; remember();
      }
      accept(prepared);
      if (prepared.state !== 'reserved') {await readStatus(check); return;}
      const ticket = await call('ocr_ticket', {operationId}, check); check(); accept(ticket);
      const sent=await files.upload(ticket, {...source, name:ticket.filename}, check); check();
      if(sent?.accepted===true) {accept(await call('ocr_ack', {operationId}, check));check();}
      message = 'ה־PDF נשלח. בדיקת פענוח תאמת את קובץ המקור לפני הצגת ההצעות; אישור ההעלאה לבדו אינו הוכחת קליטה.';
    });
  }
  const status = () => run(async () => {if (!operationId) return false; item = null; await readStatus(capture());});
  function fill() {
    return run(async () => {
      const check = capture(), snapshot = item;
      if (!operationId || !snapshot || !result?.sourceVerified || !canStart()) throw new Error('נדרש שיוך מאומת של מסמך המקור לפני מילוי השדות.');
      const source = selected();
      if (source && await ocrFileHash(source.file) !== result.fileSha256) throw new Error('הקובץ בתצוגה אינו מסמך המקור של טיוטה זו. יש לבחור את ה־PDF המתאים.');
      check();
      const approved = await confirmDialog('מילוי הצעות OCR בטופס', 'השדות הקיימים יוחלפו בהצעות מהטיוטה. יש לבדוק ספק, מספר, תאריך וסכומים מול המקור. תיקונים בטופס אינם נשלחים לטיוטת Morning; האישור מתבצע שם.', {confirmText:'מילוי לבדיקה'});
      check(); if (!approved) return false;
      await apply(snapshot, check); check(); message = 'ההצעות מולאו לבדיקה. יש להשלים את התיקונים והאישור במורנינג.';
    });
  }
  function defer() {
    return run(async () => {
      const check = capture(), approved = await confirmDialog('השארת טיוטה ממתינה במורנינג', 'הטיוטה והבירור יישארו ביומן השרת. המעבר לקובץ הבא אינו אישור הוצאה. יש להשלים את התיקונים והאישור במורנינג.', {confirmText:'סימון כממתינה ומעבר'});
      check(); if (!approved || !operationId) return false;
      let saved;
      try {saved = await call('ocr_defer', {operationId}, check);}
      catch (error) {check(); if (error.code !== 'morning_ocr_operation_missing') throw error;}
      check();
      localStorage.removeItem(key());
      pending = [...(saved ? [saved] : []), ...pending.filter(row => row.operationId !== operationId)].slice(0, 20);
      operationId = ''; result = null; item = null; message = 'הטיוטה נשארה ממתינה במורנינג.'; advance();
    });
  }
  function resume(element) {
    return run(async () => {
      if (operationId || !canStart() || !uuid(element.dataset.ocrOperation)) return false;
      const check = capture(); operationId = element.dataset.ocrOperation; remember(); item = null; await readStatus(check);
    });
  }
  function markup() {
    if (!capabilities()?.ocr && !operationId && !pending.length) return '';
    const button = (command, label, disabled) => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="ocr-${command}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    return `<section class="morning-expense-operation" data-expense-ocr aria-label="סריקת מסמכי מקור">
      <b>סריקה באמצעות Morning · אישור סופי במורנינג</b>
      <p>הזיהוי מציע נתונים לבדיקה. תיקונים כאן אינם מעדכנים את הטיוטה במורנינג.</p>
      ${button('start', result?.state === 'reserved' ? 'המשך העלאה שמורה' : 'סריקת PDF ב־Morning', busy() || !capabilities().ocr || !canStart() || !selected() || selected().type !== 'application/pdf' || operationId && result?.state !== 'reserved')}
      ${operationId ? `<small>מזהה סריקה: <bdi>${esc(operationId)}</bdi> · ${esc(labels[result?.state] || 'מצב לא ידוע')}</small>
      ${result?.draftId ? `<small>מזהה טיוטה במורנינג: <bdi>${esc(result.draftId)}</bdi></small>` : ''}
      ${button('status','בדיקת פענוח ומסמך מקור',busy())}${button('fill','מילוי שדות מזוהים לבדיקה',busy() || !item || !canStart())}${button('defer','השארה כממתינה ומעבר לקובץ הבא',busy())}` : ''}
      ${item ? `<p>ספק שזוהה: ${esc(item.supplier?.name || 'חסר')} · מספר עוסק שזוהה: ${esc(item.supplier?.taxId || 'חסר — נדרשת בחירה ידנית')} · ${esc(item.currency || 'מטבע חסר')} · סיווג מוצע: ${esc(item.classification?.title || 'חסר')}<br>סיום הפענוח טרם אומת. ${item.missingFields?.length ? 'שדות חסרים: ' + esc(item.missingFields.join(', ')) : 'יש לבדוק את כל השדות מול המקור.'}</p>` : ''}
      <p role="status" aria-live="polite">${esc(message)}</p>
      ${pending.length ? `<details><summary>20 פעולות הסריקה האחרונות · כולל ממתינות</summary>${pending.map(row => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="ocr-resume" data-ocr-operation="${esc(row.operationId)}" ${busy() || operationId || !canStart() ? 'disabled' : ''}>בירור ${esc(row.operationId)} · ${esc(labels[row.state] || 'מצב לא ידוע')}</button>`).join('')}</details>` : ''}</section>`;
  }
  return {markup, initialize, reset, active:() => !!operationId, start, status, fill, defer, resume};
}
