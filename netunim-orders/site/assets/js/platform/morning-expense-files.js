export async function validateExpenseFile(file) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('יש לבחור PDF, JPG או PNG עד 20MB.');
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d ? 'application/pdf' :
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' :
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? 'image/png' : '';
  if (!type || file.type && file.type !== type) throw new Error('סוג הקובץ אינו תואם לתוכן. יש לבחור PDF, JPG או PNG תקין.');
  return {file, type, name:typeof file.name === 'string' ? file.name.slice(0, 180) : 'invoice'};
}
export async function uploadExpenseFile(ticket, selected, assertCurrent, {fetch:send = globalThis.fetch, now = Date.now, timeoutMs = 45000} = {}) {
  assertCurrent();
  const endpoints = ['https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded', 'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded'];
  if (!endpoints.includes(ticket?.url) || !ticket.fields || typeof ticket.fields !== 'object' || Array.isArray(ticket.fields) ||
      !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= now() || !Number.isSafeInteger(ticket.maxFileSize) || ticket.maxFileSize <= 0 || selected.file.size > ticket.maxFileSize) throw new Error('פרטי ההעלאה פגו או אינם תקינים. יש לבדוק את מצב הקובץ.');
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) {
    if (key.toLowerCase() === 'file' || typeof value !== 'string') throw new Error('פרטי ההעלאה אינם תקינים.');
    form.append(key, value);
  }
  // The official flow requires file LAST. No Authorization header or cookies go to S3.
  form.append('file', selected.file, selected.name);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(ticket.url, {method:'POST', body:form, credentials:'omit', redirect:'error', signal:controller.signal});
    assertCurrent();
    if (response.status !== 204) throw new Error('הקובץ לא אושר לעיבוד. יש לבדוק את מצבו ב־Morning.');
    return {accepted:true, fileLinked:false};
  } finally { clearTimeout(timer); }
}
