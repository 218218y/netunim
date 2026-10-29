import {esc} from '../../core/values.js';
import {invoiceHighlightTargets,invoiceHighlightRects} from '../../core/invoice-highlights.js';

// Raster-only preview and source-coordinate overlays. No PDF actions or forms.
export function createExpensePdfPreview({capture,run,isActive,host=()=>document.querySelector('[data-morning-expense-intake]')}) {
  let source=null,revision=0,controller=null,image='',page=1,pages=0,pending=false,message='';
  let targets=[],current=0,viewportModel=null,focusAfterDraw=false,zoom=1;
  function release(){if(image)URL.revokeObjectURL(image);image='';viewportModel=null;}
  function reset(){
    controller?.abort();controller=null;revision++;source=null;release();page=1;pages=0;pending=false;message='';
    targets=[];current=0;focusAfterDraw=false;zoom=1;
  }
  const button=(command,label,disabled=false)=>`<button type="button" class="btn" data-action="morning-expense-command"
    data-expense-command="pdf-${command}" ${disabled?'disabled':''}>${label}</button>`;
  function markup(){
    const rects=viewportModel?invoiceHighlightRects(targets,page,viewportModel):[];
    return `<div data-expense-pdf-preview>${source?`
      <div class="morning-expense-toolbar morning-expense-pdf-navigation">
        ${button('prev','עמוד קודם',pending||page<=1)}<span>עמוד ${page}${pages?' מתוך '+pages:''}</span>
        ${button('next','עמוד הבא',pending||!pages||page>=pages)}
        ${button('zoom-in','הגדלה',!image||zoom>=2)}${button('zoom-out','הקטנה',!image||zoom<=1)}
      </div>
      ${targets.length?`<div class="morning-expense-toolbar morning-expense-match-navigation" aria-label="מעבר בין נתונים שזוהו">
        ${button('match-prev','נתון קודם',pending)}<strong data-pdf-current-field>
          ${current+1}/${targets.length} · ${esc(targets[current]?.label)}${targets[current]?.computed?' · מחושב מסה״כ ומע״מ':''}
        </strong>${button('match-next','נתון הבא',pending)}</div>`:''}
      <div class="morning-expense-pdf-viewport" data-invoice-pdf-viewport tabindex="0" aria-label="מסמך המקור להשוואה">
        ${image?`<div class="morning-expense-pdf-page" style="width:${zoom*100}%">
          <img src="${esc(image)}" width="${Math.floor(viewportModel.width)}" height="${Math.floor(viewportModel.height)}" alt="עמוד ${page} של חשבונית המקור">
          <div class="morning-expense-pdf-markers">${rects.map(rect=>`<button type="button"
            class="morning-expense-pdf-mark${rect.index===current?' current':''}" data-action="morning-expense-command"
            data-expense-command="pdf-target" data-pdf-target="${rect.index}" aria-label="${esc(rect.label)}" title="${esc(rect.label)}"
            style="left:${rect.left}%;top:${rect.top}%;width:${rect.width}%;height:${rect.height}%"></button>`).join('')}
          </div></div>`:`<p>${esc(message)}</p>`}
      </div><small role="status">${esc(message)}</small>`:''}</div>`;
  }
  function update(focus=false){
    if(!isActive())return;
    const target=host()?.querySelector('[data-expense-pdf-preview]');if(!target)return;
    const old=target.querySelector('[data-invoice-pdf-viewport]'),top=old?.scrollTop||0,left=old?.scrollLeft||0;
    target.outerHTML=markup();
    const viewport=host()?.querySelector('[data-invoice-pdf-viewport]');if(!viewport)return;
    viewport.scrollTop=top;viewport.scrollLeft=left;
    if(focus){
      const mark=viewport.querySelector('.morning-expense-pdf-mark.current');
      if(mark){viewport.scrollTop=mark.offsetTop-viewport.clientHeight*.4;viewport.scrollLeft=mark.offsetLeft-viewport.clientWidth*.4;}
    }
  }
  function select(item){reset();if(item?.type==='application/pdf'){source=item;return draw();}}
  function setFields(fields){
    targets=invoiceHighlightTargets(fields);current=0;
    if(targets.length&&targets[0].sources[0].page!==page){
      if(pending)focusAfterDraw=true;else return goTarget(0);
    }
    update(true);
  }
  function draw(){
    if(!source||pending||!isActive())return false;
    const renderingController=new AbortController();controller=renderingController;
    const signal=renderingController.signal,epoch=revision,file=source.file,base=capture();
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
        const [{loadPdfCore},{invoicePdfOptions,INVOICE_PDF_LIMITS}]=await bounded(Promise.all([
          import('../documents/pdfjs-core.js'),import('./invoice-pdf.js')]));check();
        if(!file.size||file.size>INVOICE_PDF_LIMITS.bytes)throw Error('size');
        const data=new Uint8Array(await bounded(file.arrayBuffer()));check();
        const core=await bounded(loadPdfCore());check();task=core.getDocument(invoicePdfOptions(data));
        const doc=await bounded(task.promise);check();
        if(!Number.isSafeInteger(doc.numPages)||doc.numPages<1||doc.numPages>INVOICE_PDF_LIMITS.pages)throw Error('pages');pages=doc.numPages;
        pdfPage=await bounded(doc.getPage(page));check();
        const natural=pdfPage.getViewport({scale:1});
        if(!Number.isFinite(natural.width)||!Number.isFinite(natural.height)||natural.width<=0||natural.height<=0)throw Error('dimensions');
        const scale=Math.min(1.6,1200/natural.width,4096/natural.height,Math.sqrt(3000000/(natural.width*natural.height)));
        const viewport=pdfPage.getViewport({scale});canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
        renderTask=pdfPage.render({canvas,viewport,annotationMode:0});await bounded(renderTask.promise);check();
        const blob=await bounded(new Promise(resolve=>canvas.toBlob(resolve,'image/png')));check();if(!blob)throw Error('image');
        release();image=URL.createObjectURL(blob);viewportModel=viewport;message=targets.length?'הנתונים שזוהו מסומנים בצהוב. הנתון הנוכחי מסומן במסגרת כהה.':'אפשר להגדיל את המסמך ולעבור בין העמודים.';
      }catch{if(epoch===revision&&!signal.aborted)message='לא ניתן להציג את העמוד. אפשר לבחור עותק תקין ולהשלים ידנית.';}
      finally{
        clearTimeout(timer);signal.removeEventListener('abort',abort);pdfPage?.cleanup();if(canvas){canvas.width=0;canvas.height=0;}
        let cleanupTimer;
        try{await Promise.race([destroy(),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,2000);})]);}finally{clearTimeout(cleanupTimer);}
        if(epoch===revision){
          pending=false;if(signal.aborted)message='התצוגה נעצרה. ניתן לבחור את הקובץ מחדש.';update(true);
          if(focusAfterDraw){focusAfterDraw=false;goTarget(current);}
        }
      }
    });
  }
  function move(delta){if(pending||!source||page+delta<1||page+delta>pages)return false;page+=delta;release();return draw();}
  function goTarget(index){
    if(pending||!Number.isInteger(index)||index<0||index>=targets.length)return false;
    current=index;const desired=targets[index].sources[0].page;
    if(desired!==page){if(!pages||desired>pages)return false;page=desired;release();return draw();}
    update(true);return true;
  }
  function match(delta){return targets.length?goTarget((current+delta+targets.length)%targets.length):false;}
  function resize(delta){zoom=Math.max(1,Math.min(2,zoom+delta));update(true);return true;}
  return {select,reset,markup,setFields,previous:()=>move(-1),next:()=>move(1),
    previousMatch:()=>match(-1),nextMatch:()=>match(1),target:element=>goTarget(Number(element.dataset.pdfTarget)),
    field:key=>goTarget(targets.findIndex(target=>target.key===key)),
    zoomIn:()=>resize(.25),zoomOut:()=>resize(-.25)};
}
