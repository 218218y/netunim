import {loadPdfCore} from '../documents/pdfjs-core.js';
import {invoicePdfOptions, INVOICE_PDF_LIMITS} from './invoice-pdf.js';

export async function splitInvoicePdf(file, pageNumbers, {signal, check = () => {}, load = loadPdfCore, timeoutMs = 45000} = {}) {
  if (!(file instanceof Blob) || !file.size || file.size > INVOICE_PDF_LIMITS.bytes || !Array.isArray(pageNumbers) || pageNumbers.length < 2 || pageNumbers.length > 20 || pageNumbers.some((page,index) => page !== index + 1)) throw Error('invoice_split_plan_invalid');
  let task, timer, abort;
  const cancelled = new Promise((_,reject) => {
    abort = () => reject(signal?.reason || new DOMException('Aborted','AbortError'));
    timer = setTimeout(() => reject(new DOMException('invoice_split_timeout','TimeoutError')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
  });
  const current = () => {check();if (signal?.aborted) throw signal.reason || new DOMException('Aborted','AbortError');};
  const bounded = promise => Promise.race([promise,cancelled]);
  try {
    current(); const data = new Uint8Array(await bounded(file.arrayBuffer())); current();
    if (![37,80,68,70,45].every((value,index) => data[index] === value)) throw Error('invoice_pdf_type');
    const core = await bounded(load()); current(); task = core.getDocument(invoicePdfOptions(data));
    const document = await bounded(task.promise); current();
    if (document.numPages !== pageNumbers.length || typeof document.extractPages !== 'function') throw Error('invoice_split_plan_invalid');
    const files = [], stem = String(file.name || 'invoice.pdf').replace(/\.pdf$/i,'').slice(0,130);
    for (const page of pageNumbers) {
      const bytes = await bounded(document.extractPages([{document:null,includePages:[page - 1]}])); current();
      if (!(bytes instanceof Uint8Array) || bytes.length > INVOICE_PDF_LIMITS.bytes || ![37,80,68,70,45].every((value,index) => bytes[index] === value)) throw Error('invoice_split_output_invalid');
      files.push(new File([bytes],`${stem} - ${page}.pdf`,{type:'application/pdf'}));
    }
    return files;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort',abort);
    if (task) {let cleanup;try{await Promise.race([Promise.resolve().then(()=>task.destroy()).catch(()=>{}),new Promise(resolve=>{cleanup=setTimeout(resolve,2000);})]);}finally{clearTimeout(cleanup);}}
  }
}
