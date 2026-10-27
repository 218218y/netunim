import {PDFJS_VERSION,PDFJS_BUILD} from './pdfjs-runtime-config.js';

const root='../../../vendor/pdfjs/';
export const PDF_CORE_RUNTIME=Object.freeze({version:PDFJS_VERSION,build:PDFJS_BUILD,root,
  pdf:root+'build/pdf.mjs',worker:root+'build/pdf.worker.min.mjs',cmaps:root+'cmaps/',iccs:root+'iccs/',standardFonts:root+'standard_fonts/',wasm:root+'wasm/'});
export const pdfRuntimeUrl=relative=>new URL(relative,import.meta.url).href;
let loading=null;
export function assertPdfJsCore(pdfjs){
  if(pdfjs?.version!==PDFJS_VERSION||pdfjs?.build!==PDFJS_BUILD||typeof pdfjs?.getDocument!=='function'||!pdfjs?.GlobalWorkerOptions)throw new Error('pdfjs_core_contract_mismatch');
}
export function loadPdfCore(){
  if(!loading)loading=(async()=>{
    const missing=[typeof Promise.try!=='function',typeof Uint8Array.prototype.toHex!=='function',typeof Math.sumPrecise!=='function',
      typeof Map.prototype.getOrInsert!=='function',typeof Map.prototype.getOrInsertComputed!=='function'];
    if(missing.some(Boolean))throw new Error('pdfjs_current_browser_required');
    const pdfjs=await import('../../../vendor/pdfjs/build/pdf.mjs');
    assertPdfJsCore(pdfjs);pdfjs.GlobalWorkerOptions.workerSrc=pdfRuntimeUrl(PDF_CORE_RUNTIME.worker);return pdfjs;
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
