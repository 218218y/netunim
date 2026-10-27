import {loadPdfCore,PDF_CORE_RUNTIME,pdfRuntimeUrl} from '../documents/pdfjs-core.js';
import {invoicePageGeometry} from '../../core/invoice-pdf-layout.js';

export const INVOICE_PDF_LIMITS=Object.freeze({bytes:20*1024*1024,pages:60,items:100000,characters:1000000});
export const invoicePdfOptions=data=>({data,isEvalSupported:false,enableXfa:false,disableFontFace:true,useSystemFonts:false,stopAtErrors:true,verbosity:0,
  cMapUrl:pdfRuntimeUrl(PDF_CORE_RUNTIME.cmaps),cMapPacked:true,standardFontDataUrl:pdfRuntimeUrl(PDF_CORE_RUNTIME.standardFonts),
  iccUrl:pdfRuntimeUrl(PDF_CORE_RUNTIME.iccs),wasmUrl:pdfRuntimeUrl(PDF_CORE_RUNTIME.wasm)});
export async function extractInvoicePdf(file,{signal,check=()=>{},load=loadPdfCore,timeoutMs=20000}={}){
  if(!(file instanceof Blob)||file.size<=0||file.size>INVOICE_PDF_LIMITS.bytes)throw new Error('invoice_pdf_size');
  const controller=new AbortController();let task=null,destroyed=null;
  const destroy=()=>destroyed||=(task?Promise.resolve().then(()=>task.destroy()).catch(()=>{}):Promise.resolve());
  const cancel=()=>{controller.abort(signal.reason);void destroy();};
  const timer=setTimeout(()=>{controller.abort(new DOMException('invoice_pdf_timeout','TimeoutError'));void destroy();},timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  const assertCurrent=()=>{check();if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');if(controller.signal.aborted)throw controller.signal.reason;};
  const bounded=promise=>new Promise((resolve,reject)=>{
    const abort=()=>reject(controller.signal.reason||new DOMException('Aborted','AbortError'));
    if(controller.signal.aborted){abort();return;}
    controller.signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));
  });
  try{
    assertCurrent();const data=new Uint8Array(await bounded(file.arrayBuffer()));assertCurrent();
    if(![37,80,68,70,45].every((n,index)=>data[index]===n))throw new Error('invoice_pdf_type');
    const pdfjs=await bounded(load());assertCurrent();
    task=pdfjs.getDocument(invoicePdfOptions(data));
    const doc=await bounded(task.promise);assertCurrent();
    if(!Number.isSafeInteger(doc.numPages)||doc.numPages<=0||doc.numPages>INVOICE_PDF_LIMITS.pages)throw new Error('invoice_pdf_pages');
    const pages=[];let items=0,characters=0;
    for(let n=1;n<=doc.numPages;n++){
      const page=await bounded(doc.getPage(n));assertCurrent();
      try{
        const text=await bounded(page.getTextContent({includeMarkedContent:false,disableNormalization:false}));assertCurrent();
        items+=text.items.length;characters+=text.items.reduce((sum,item)=>sum+(item.str?.length||0),0);
        if(items>INVOICE_PDF_LIMITS.items||characters>INVOICE_PDF_LIMITS.characters)throw new Error('invoice_pdf_text_limit');
        pages.push(invoicePageGeometry(page,text));
      }finally{page.cleanup();}
      // Yield between pages without creating a background extraction queue.
      await bounded(new Promise(resolve=>setTimeout(resolve,0)));assertCurrent();
    }
    return {source:'local_pdf',version:1,pages,characters,hasText:characters>=20};
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    if(task){let cleanupTimer;try{await Promise.race([destroy(),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,2000);})]);}finally{clearTimeout(cleanupTimer);}}
  }
}
