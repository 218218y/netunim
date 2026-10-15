// Literal ESM edges stay visible to the offline shell and graph audit. Importing
// this owner allocates no viewers, workers, listeners, styles or vendor runtime.
const loaders={
  pdf:()=>import('./pdf-search-viewer.js'),
  docx:()=>import('./docx-search-viewer.js'),
  text:()=>import('./text-search-viewer.js'),
  spreadsheet:()=>import('./spreadsheet-search-viewer.js'),
};
const methods={pdf:'createPdfSearchViewer',docx:'createDocxSearchViewer',text:'createTextSearchViewer',spreadsheet:'createSpreadsheetSearchViewer'};

export function createDocumentPreviewModules({load=loaders}={}){
  const pending=new Map();
  function module(kind){
    if(pending.has(kind))return pending.get(kind);
    const task=Promise.resolve().then(()=>load[kind]());
    pending.set(kind,task);
    // Never retain a failed application loader. Native ESM owns its own cache;
    // a browser-cached module failure may still require a document reload.
    void task.catch(()=>{if(pending.get(kind)===task)pending.delete(kind)});
    return task;
  }
  async function create(kind,options,isCurrent){
    if(typeof isCurrent!=='function')throw new TypeError('preview_current_scope_required');
    if(!isCurrent())return null;
    const implementation=await module(kind);
    if(!isCurrent())return null;
    const host=options.host,mount=host.ownerDocument.createElement('div');
    mount.className='document-preview-viewer-host';host.replaceChildren(mount);
    let viewer,destruction=null;
    function destroy(){
      return destruction??=Promise.resolve().then(()=>viewer?.destroy?.()).finally(()=>mount.remove());
    }
    try{
      viewer=await implementation[methods[kind]]({...options,host:mount});
      if(!isCurrent()){await destroy();return null}
      return {...viewer,destroy};
    }catch(error){await destroy();throw error}
  }
  return {
    preloadPdfSearchRuntime:async()=>(await module('pdf')).preloadPdfSearchRuntime(),
    preloadDocxSearchRuntime:async()=>(await module('docx')).preloadDocxSearchRuntime(),
    createPdfSearchViewer:(options,current)=>create('pdf',options,current),
    createDocxSearchViewer:(options,current)=>create('docx',options,current),
    createTextSearchViewer:(options,current)=>create('text',options,current),
    createSpreadsheetSearchViewer:(options,current)=>create('spreadsheet',options,current),
  };
}
