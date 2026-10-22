let loadError='';
try{importScripts('../../shared/document-text-search-worker.js','../../../vendor/document-viewers/xlsx/xlsx.full.min.js')}catch(error){loadError=String(error?.message||error)}

let workbook=null,sheets=[],matches=[],query='',contentSearch={matchMode:'phrase',wordMatch:'partial',proximityWords:0};
const MAX_MATCHES=5000,FULL_AREA_LIMIT=24000,MAX_ROWS=90,MAX_COLS=36;
function snippet(text,start,end){const context=56,a=Math.max(0,start-context),b=Math.min(text.length,end+context);return {before:text.slice(a,start).replace(/\s+/g,' ').trimStart(),match:text.slice(start,end),after:text.slice(end,b).replace(/\s+/g,' ').trimEnd(),leading:a>0,trailing:b<text.length}}
function cellAt(ws,r,c){if(ws?.['!data'])return ws['!data']?.[r]?.[c]||null;if(Array.isArray(ws))return ws?.[r]?.[c]||null;return ws?.[globalThis.XLSX.utils.encode_cell({r,c})]||null}
function cellText(cell){if(!cell)return '';if(cell.w!=null)return String(cell.w);if(cell.v==null)return '';return cell.v instanceof Date?cell.v.toLocaleString('he-IL'):String(cell.v)}
function usedRange(ws){try{return ws?.['!ref']?globalThis.XLSX.utils.decode_range(ws['!ref']):{s:{r:0,c:0},e:{r:0,c:0}}}catch{return {s:{r:0,c:0},e:{r:0,c:0}}}}

function scan(){
  matches=[];
  const matcher=createDocumentTextMatcher(query,contentSearch);
  const required=matcher.requiredTerms,foundTerms=new Set(),all=matcher.search.matchMode==='all';
  sheets=workbook.SheetNames.map((name,index)=>{
    const ws=workbook.Sheets[name],range=usedRange(ws),area=(range.e.r-range.s.r+1)*(range.e.c-range.s.c+1);
    let nonEmpty=0;
    for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){
      const text=cellText(cellAt(ws,r,c));if(!text)continue;nonEmpty++;
      const remaining=MAX_MATCHES-matches.length;
      // Workbook-wide AND presence must keep scanning after display is full.
      if(!remaining&&(!all||required.every(term=>foundTerms.has(term))))continue;
      const found=matcher.find(text,{maxMatches:Math.max(1,remaining),matchMode:all?'any':matcher.search.matchMode});
      for(const term of found.foundTerms)foundTerms.add(term);
      if(!remaining)continue;
      for(const rangeMatch of found.matches){
        matches.push({sheet:index,row:r,col:c,text,start:rangeMatch.start,end:rangeMatch.end,snippet:snippet(text,rangeMatch.start,rangeMatch.end)});
      }
    }
    return {name,index,range,area,nonEmpty,full:area<=FULL_AREA_LIMIT&&range.e.r-range.s.r<800&&range.e.c-range.s.c<160};
  });
  if(all&&required.some(term=>!foundTerms.has(term)))matches=[];
  matches.forEach((match,index)=>{match.navIndex=index});
}
function windowFor(sheetIndex,focus){const meta=sheets[sheetIndex],range=meta.range;if(meta.full)return range;const center=focus||{row:range.s.r,col:range.s.c};const halfRows=Math.floor(MAX_ROWS/2),halfCols=Math.floor(MAX_COLS/2);let sr=Math.max(range.s.r,center.row-halfRows),sc=Math.max(range.s.c,center.col-halfCols);let er=Math.min(range.e.r,sr+MAX_ROWS-1),ec=Math.min(range.e.c,sc+MAX_COLS-1);sr=Math.max(range.s.r,er-MAX_ROWS+1);sc=Math.max(range.s.c,ec-MAX_COLS+1);return {s:{r:sr,c:sc},e:{r:er,c:ec}}}
function renderModel(sheetIndex,focus){const meta=sheets[sheetIndex],ws=workbook.Sheets[meta.name],range=windowFor(sheetIndex,focus),cells=[];for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){const text=cellText(cellAt(ws,r,c));if(text)cells.push({row:r,col:c,text})}return {sheet:meta,window:range,cells}}
self.onmessage=event=>{try{const msg=event.data||{};if(loadError)throw new Error(`SheetJS local runtime failed to load: ${loadError}`);if(!globalThis.XLSX)throw new Error('SheetJS local runtime is unavailable');if(msg.type==='open'){query=String(msg.query||'').trim();contentSearch=createDocumentTextMatcher('',msg.contentSearch).search;workbook=globalThis.XLSX.read(msg.buffer,{type:'array',dense:true,cellDates:true,cellText:true,cellNF:false,cellStyles:false});scan();const first=matches[0]||null;self.postMessage({id:msg.id,ok:true,type:'opened',sheets,matches,capped:matches.length>=MAX_MATCHES,initialSheet:first?.sheet||0,model:renderModel(first?.sheet||0,first?{row:first.row,col:first.col}:null)});return}if(msg.type==='render-sheet'){if(!workbook)throw new Error('Workbook is not open');self.postMessage({id:msg.id,ok:true,type:'sheet',model:renderModel(Number(msg.sheet)||0,msg.focus||null)});return}}catch(error){self.postMessage({id:event.data?.id,ok:false,error:String(error?.message||error)})}}
