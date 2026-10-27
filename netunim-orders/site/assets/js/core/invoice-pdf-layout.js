// Search views retain character-to-source mappings; raw PDF text is never edited.
export const invoiceLabelKey=value=>String(value).replace(/[ðª]/g,'נ').normalize('NFKC').replace(/[\s\p{P}\p{Cf}`]/gu,'').toLowerCase();
function bounds(items){const x=Math.min(...items.map(item=>item.x)),y=Math.min(...items.map(item=>item.y));return {x,y,width:Math.max(...items.map(item=>item.x+item.width))-x,height:Math.max(...items.map(item=>item.height))};}
function searchView(items){
  let text='',key='';const sources=[];
  for(const item of [...items].sort((a,b)=>b.x-a.x||a.index-b.index)){
    text+=item.text+' ';
    for(const char of item.text){const normalized=invoiceLabelKey(char);key+=normalized;for(let n=0;n<normalized.length;n++)sources.push(item.index);}
  }
  return {text:text.trim(),key,sources};
}
export function invoicePdfLines(items){
  const ordered=items.filter(item=>item.text.trim()).sort((a,b)=>a.y-b.y||a.x-b.x),lines=[];
  for(const item of ordered){
    const tolerance=Math.max(1.5,Math.min(3,item.height*.25));
    let line=lines.at(-1);
    if(!line||Math.abs(line.y-item.y)>tolerance){line={page:item.page,y:item.y,items:[]};lines.push(line);}
    if(line.items.length>=2000)throw new Error('invoice_pdf_layout_limit');
    // Some issuers overprint identical values a fraction of a point apart.
    // Keep every original item in page.items; deduplicate only this search view.
    if(!line.items.some(prior=>prior.text===item.text&&Math.abs(prior.x-item.x)<=1&&Math.abs(prior.y-item.y)<=1))line.items.push(item);
  }
  return lines.map(line=>{
    const sorted=line.items.sort((a,b)=>a.x-b.x),groups=[];
    for(const item of sorted){
      const previous=groups.at(-1),end=previous?Math.max(...previous.map(part=>part.x+part.width)):0;
      if(!previous||item.x-end>Math.max(9,item.height))groups.push([item]);else previous.push(item);
    }
    return {...line,...searchView(line.items),cells:groups.map(group=>({...bounds(group),...searchView(group),items:group}))};
  });
}
export function invoicePageGeometry(page,content){
  const viewport=page.getViewport({scale:1}),v=viewport.transform;
  const point=(x,y)=>({x:v[0]*x+v[2]*y+v[4],y:v[1]*x+v[3]*y+v[5]});
  const raw=content.items.filter(item=>typeof item.str==='string');
  if(raw.some(item=>!Array.isArray(item.transform)||item.transform.length!==6||item.transform.some(n=>!Number.isFinite(n))||
      !Number.isFinite(item.width)||item.width<0||!Number.isFinite(item.height)||item.height<0))throw new Error('invoice_pdf_geometry');
  const angles=new Map();
  for(const item of raw){const t=item.transform,a=point(t[4],t[5]),b=point(t[4]+t[0],t[5]+t[1]);const angle=Math.round(Math.atan2(b.y-a.y,b.x-a.x)/(Math.PI/2));angles.set(angle,(angles.get(angle)||0)+item.str.length);}
  const angle=[...angles].sort((a,b)=>b[1]-a[1])[0]?.[0]||0,theta=-angle*Math.PI/2;
  const rotate=p=>({x:p.x*Math.cos(theta)-p.y*Math.sin(theta),y:p.x*Math.sin(theta)+p.y*Math.cos(theta)});
  const corners=[[0,0],[viewport.width,0],[0,viewport.height],[viewport.width,viewport.height]].map(([x,y])=>rotate({x,y}));
  const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
  const items=raw.map((item,index)=>{
    const t=item.transform,a=rotate(point(t[4],t[5]));
    return {page:page.pageNumber,index,text:item.str,dir:item.dir,x:a.x-left,y:a.y-top,width:item.width,height:item.height,
      fontName:item.fontName,hasEOL:item.hasEOL===true,transform:[...t],original:{x:t[4],y:t[5]}};
  });
  return {page:page.pageNumber,rotation:page.rotate,readingRotation:angle*90,width:Math.max(...corners.map(p=>p.x))-left,height:Math.max(...corners.map(p=>p.y))-top,
    styles:content.styles,items,lines:invoicePdfLines(items)};
}
