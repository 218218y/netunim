import {esc} from '../../core/values.js';

// Raster-only preview: no PDF actions, links, forms, annotation layer or scripts.
// Keep one bounded page image; release the document/worker after each render.
export function createExpensePdfPreview({capture, run}) {
  let source=null, revision=0, controller=null, image='', page=1, pages=0, pending=false, message='';
  function release(){if(image)URL.revokeObjectURL(image);image='';}
  function reset(){controller?.abort();controller=null;revision++;source=null;release();page=1;pages=0;pending=false;message='';}
  function markup(){return `<div data-expense-pdf-preview>${source?`<div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="pdf-prev" ${pending||page<=1?'disabled':''}>עמוד קודם</button><span>עמוד ${page}${pages?' מתוך '+pages:''}</span><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="pdf-next" ${pending||!pages||page>=pages?'disabled':''}>עמוד הבא</button></div>${image?`<img src="${esc(image)}" alt="עמוד ${page} של חשבונית המקור">`:''}<p role="status">${esc(message)}</p>`:''}</div>`;}
  function update(){const target=document.querySelector('[data-morning-expense-intake] [data-expense-pdf-preview]');if(target)target.outerHTML=markup();}
  function select(item){reset();if(item?.type==='application/pdf'){source=item;return draw();}}
  function draw(){
    if(!source||pending)return false;
    const renderingController=new AbortController();controller=renderingController;const signal=renderingController.signal,epoch=revision,file=source.file,base=capture();
    pending=true;message='טוען תצוגת עמוד…';update();
    return run(async()=>{
      let task=null,renderTask=null,pdfPage=null,canvas=null,destroyed=null;
      const destroy=()=>destroyed||=(task?Promise.resolve().then(()=>task.destroy()).catch(()=>{}):Promise.resolve());
      const abort=()=>{renderTask?.cancel();void destroy();};signal.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>renderingController.abort(),20000);
      const check=()=>{base();if(signal.aborted||epoch!==revision)throw new DOMException('Aborted','AbortError');};
      const bounded=value=>new Promise((resolve,reject)=>{
        const cancelled=()=>reject(new DOMException('Aborted','AbortError'));
        if(signal.aborted){cancelled();return;}signal.addEventListener('abort',cancelled,{once:true});
        Promise.resolve(value).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancelled));
      });
      try{
        const [{loadPdfCore},{invoicePdfOptions,INVOICE_PDF_LIMITS}]=await bounded(Promise.all([import('../documents/pdfjs-core.js'),import('./invoice-pdf.js')]));check();
        if(!file.size||file.size>INVOICE_PDF_LIMITS.bytes)throw Error('size');
        const data=new Uint8Array(await bounded(file.arrayBuffer()));check();
        const core=await bounded(loadPdfCore());check();task=core.getDocument(invoicePdfOptions(data));
        const doc=await bounded(task.promise);check();
        if(!Number.isSafeInteger(doc.numPages)||doc.numPages<1||doc.numPages>INVOICE_PDF_LIMITS.pages)throw Error('pages');pages=doc.numPages;
        pdfPage=await bounded(doc.getPage(page));check();
        const natural=pdfPage.getViewport({scale:1});
        if(!Number.isFinite(natural.width)||!Number.isFinite(natural.height)||natural.width<=0||natural.height<=0)throw Error('dimensions');
        const scale=Math.min(1.6,1200/natural.width,4096/natural.height,Math.sqrt(3000000/(natural.width*natural.height)));
        const viewport=pdfPage.getViewport({scale});canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
        renderTask=pdfPage.render({canvas,viewport,annotationMode:0});await bounded(renderTask.promise);check();
        const blob=await bounded(new Promise(resolve=>canvas.toBlob(resolve,'image/png')));check();if(!blob)throw Error('image');
        release();image=URL.createObjectURL(blob);message='תצוגה לקריאה בלבד. יש לבדוק את פרטי החשבונית מול המקור.';
      }catch{if(epoch===revision&&!signal.aborted)message='לא ניתן להציג את העמוד. אפשר לבחור עותק תקין ולהשלים ידנית.';}
      finally{
        clearTimeout(timer);signal.removeEventListener('abort',abort);pdfPage?.cleanup();if(canvas){canvas.width=0;canvas.height=0;}
        let cleanupTimer;try{await Promise.race([destroy(),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,2000);})]);}finally{clearTimeout(cleanupTimer);}
        if(epoch===revision){pending=false;if(signal.aborted)message='התצוגה נעצרה. ניתן לבחור את הקובץ מחדש.';update();}
      }
    });
  }
  function move(delta){if(pending||!source||page+delta<1||page+delta>pages)return false;page+=delta;release();return draw();}
  return {select,reset,markup,previous:()=>move(-1),next:()=>move(1)};
}
