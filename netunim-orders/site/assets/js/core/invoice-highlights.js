export const INVOICE_HIGHLIGHT_FIELDS = Object.freeze([
  ['supplier','ספק · מספר עוסק'],['documentType','סוג מסמך'],['invoiceNumber','מספר חשבונית'],['date','תאריך חשבונית'],
  ['net','לפני מע״מ'],['vat','מע״מ מהחשבונית'],['gross','כולל מע״מ'],['allocationNumber','מספר הקצאה'],
]);
export function invoiceHighlightTargets(fields = {}) {
  return INVOICE_HIGHLIGHT_FIELDS.flatMap(([key,label]) => {
    const field=fields[key];if(!field||field.value===null||field.value===undefined)return [];
    const candidates=key==='net'&&field.method==='gross_minus_explicit_vat' ? [fields.gross?.sources?.[0],fields.vat?.sources?.[0]] :
      key==='documentType'?field.sources:field.sources?.slice(0,1);
    const sources=(candidates||[]).filter(source=>Number.isInteger(source?.page)&&source.page>0&&
      Array.isArray(source.quad)&&source.quad.length===8&&source.quad.every(Number.isFinite));
    return sources.length?[{key,label,computed:key==='net'&&field.method==='gross_minus_explicit_vat',sources}]:[];
  });
}
export function invoiceHighlightRects(targets,page,viewport) {
  return targets.flatMap((target,index)=>target.sources.filter(source=>source.page===page).map(source=>{
    const points=[];for(let n=0;n<8;n+=2)points.push(viewport.convertToViewportPoint(source.quad[n],source.quad[n+1]));
    const x=Math.max(0,Math.min(...points.map(p=>p[0]))-2),y=Math.max(0,Math.min(...points.map(p=>p[1]))-1);
    const right=Math.min(viewport.width,Math.max(...points.map(p=>p[0]))+2),bottom=Math.min(viewport.height,Math.max(...points.map(p=>p[1]))+1);
    return {index,key:target.key,label:target.label,left:x/viewport.width*100,top:y/viewport.height*100,
      width:(right-x)/viewport.width*100,height:(bottom-y)/viewport.height*100};
  })).filter(rect=>[rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)&&rect.width>0&&rect.height>0);
}
