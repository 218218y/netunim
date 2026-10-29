export async function validateExpenseFile(file) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('יש לבחור PDF, JPG או PNG עד 20MB.');
  let buffer;try{buffer=await file.arrayBuffer();}catch{throw Error('לא ניתן לקרוא את הקובץ. יש לבחור אותו מחדש לפני שמירת ההוצאה.');}
  if(buffer.byteLength!==file.size)throw Error('תוכן הקובץ השתנה בזמן הקריאה. יש לבחור אותו מחדש.');
  const bytes = new Uint8Array(buffer,0,Math.min(8,buffer.byteLength));
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d ? 'application/pdf' :
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' :
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? 'image/png' : '';
  if (!type || file.type && file.type !== type) throw new Error('סוג הקובץ אינו תואם לתוכן. יש לבחור PDF, JPG או PNG תקין.');
  // A disk-backed File can become unreadable after a move/delete. Own its bytes
  // before putting it in the bounded queue; subsequent work never reopens disk.
  const name=typeof file.name === 'string' ? file.name.slice(0,180) : 'invoice';
  return {file:new File([buffer],name,{type}),type,name};
}
export async function uploadExpenseFile(ticket, selected, assertCurrent, {fetch:send = globalThis.fetch, now = Date.now, timeoutMs = 45000} = {}) {
  assertCurrent();
  const endpoints = ['https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded', 'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded'];
  if (!endpoints.includes(ticket?.url) || !ticket.fields || typeof ticket.fields !== 'object' || Array.isArray(ticket.fields) ||
      !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= now() || !Number.isSafeInteger(ticket.maxFileSize) || ticket.maxFileSize <= 0 || selected.file.size > ticket.maxFileSize) throw new Error('פרטי ההעלאה פגו או אינם תקינים. יש לבדוק את מצב הקובץ.');
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) {
    if (['file','success_action_redirect','redirect'].includes(key.toLowerCase()) || typeof value !== 'string' ||
        key.toLowerCase()==='success_action_status'&&value!=='204') throw new Error('פרטי ההעלאה אינם תקינים.');
    form.append(key, value);
  }
  // The official flow requires file LAST. No Authorization header or cookies go to S3.
  form.append('file', selected.file, selected.name);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Morning's signed-form bucket does not grant our origin CORS read access.
    // Send the official browser form once; an opaque reply is NOT acceptance.
    // Completion is proved separately by canonical readback and source SHA-256.
    // Fetch requires redirect:follow with no-cors (even when no redirect occurs).
    // Reject S3 redirect form policies above; retain the site's connect-src CSP.
    const response = await send(ticket.url, {method:'POST', mode:'no-cors', body:form, credentials:'omit', redirect:'follow', signal:controller.signal});
    assertCurrent();
    if (response.type === 'opaque') return {accepted:false, fileLinked:false};
    if (response.status !== 204) throw new Error('הקובץ לא אושר לעיבוד. יש לבדוק את מצבו ב־Morning.');
    return {accepted:true, fileLinked:false};
  } finally { clearTimeout(timer); }
}
