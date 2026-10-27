import {INVOICE_SUPPLIER_PROFILES} from './invoice-supplier-profiles.js';
import {invoiceLabelKey} from './invoice-pdf-layout.js';
import {expenseCents} from './morning-expense-input.js';
import {validReportDate} from './morning-report-period.js';

const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const missing=reason=>({value:null,rawValue:null,status:'missing',method:'none',reason,sources:[]});
const source=item=>({page:item.page,item:item.index,text:item.text,bounds:{x:item.x,y:item.y,width:item.width,height:item.height}});
const field=(value,items,method='label_geometry',status='verified',reason='')=>({value,rawValue:items.map(item=>item.text).join(' '),status,method,reason,sources:items.map(source)});
export function invoiceMoneyCents(raw){
  const text=String(raw).replace(/[\p{Cf}]/gu,'').replace(/₪|ש["'`״]?ח|ILS/gu,'').trim();
  if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(text))return null;
  const positive=text.replace(/^[+-]/,'').replaceAll(',',''),cents=expenseCents(positive);
  return cents===null?null:text.startsWith('-')?-cents:cents;
}
export function invoiceDate(raw){
  const match=String(raw).match(/(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/);
  if(!match)return null;
  const value=`${match[3].length===2?'20'+match[3]:match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  return validReportDate(value)?value:null;
}
export function allocationPolicy({date,documentType,netCents,vatCents,pcnClassification='T'}){
  if(!validReportDate(date)||!Number.isSafeInteger(netCents)||!Number.isSafeInteger(vatCents))return {status:'unknown',thresholdCents:null};
  if(pcnClassification==='P'||![305,320].includes(documentType))return {status:'separate_treatment',thresholdCents:null};
  const thresholdCents=date>='2026-06-01'?500000:date>='2026-01-01'?1000000:date>='2025-01-01'?2000000:null;
  return {status:thresholdCents===null?'unknown':vatCents>0&&netCents>thresholdCents?'check_business_conditions':'below_threshold_or_no_vat',thresholdCents,officiallyValidated:false};
}
function cellsOf(pages){return pages.flatMap(page=>page.lines.flatMap(line=>line.cells.map(cell=>({...cell,key:invoiceLabelKey(cell.text),page:page.page,lineY:line.y,pageHeight:page.height}))));}
function unique(candidates,reason){
  if(!candidates.length)return missing(reason);
  const values=[...new Set(candidates.map(row=>String(row.value)))];
  if(values.length!==1)return {...missing('ambiguous_'+reason),status:'review',candidates:values};
  return candidates[0];
}
function nearbyItems(cells,anchor,dy=3){return cells.filter(cell=>cell.page===anchor.page&&Math.abs(cell.lineY-anchor.lineY)<=dy).flatMap(cell=>cell.items);}
function isPercent(item,nearby){return item.text.includes('%')||nearby.some(other=>other!==item&&other.text.includes('%')&&!/\d/.test(other.text)&&
  Math.min(Math.abs(other.x-item.x-item.width),Math.abs(item.x-other.x-other.width))<=Math.max(8,item.height*2));}
function readMoney(cells,labels,{exclude=[],lastPageOnly=true}={}){
  const maxPage=Math.max(...cells.map(cell=>cell.page));
  for(const label of labels){
    const anchors=cells.filter(cell=>(!lastPageOnly||cell.page===maxPage)&&label.test(cell.key.replace(/\d/g,''))&&!exclude.some(label=>label.test(cell.key)));
    const candidates=[];
    for(const anchor of anchors){
    const nearby=nearbyItems(cells,anchor,3);
    const amounts=nearby.map(item=>({item,cents:invoiceMoneyCents(item.text)})).filter(row=>row.cents!==null&&!isPercent(row.item,nearby)&&row.item.x<anchor.x+anchor.width+2);
    const same=amounts.filter(row=>anchor.items.includes(row.item));
    const left=amounts.filter(row=>row.item.x+row.item.width<=anchor.x+3).sort((a,b)=>b.item.x-a.item.x);
    const found=same.length===1?same[0]:left[0];
      if(found)candidates.push(field(found.cents,[found.item,...anchor.items.filter(item=>item!==found.item)]));
    }
    if(candidates.length)return unique(candidates,'money');
  }
  return missing('money');
}
function headerType(cells){
  const titles=cells.filter(cell=>cell.y<cell.pageHeight*.5&&/^חשבונית(?:מס|זיכוי)/.test(cell.key));
  const found=titles.map(cell=>({cell,type:cell.key.includes('זיכוי')?330:cell.key.includes('קבלה')?320:305}));
  const result=unique(found.map(row=>field(row.type,row.cell.items,'document_title')),'document_type');
  return {result,titles:found};
}
function invoiceNumber(cells,titles,profile){
  const candidates=[];
  for(const {cell}of titles){
    const placement=profile.numberPlacement||{minDy:-5,maxDy:profile.numberBelowTitle?30:5,minX:profile.numberBelowTitle?180:0,maxX:profile.numberBelowTitle?450:cell.x+cell.width+5};
    const items=cells.filter(row=>row.page===cell.page&&row.lineY-cell.lineY>=placement.minDy&&row.lineY-cell.lineY<=placement.maxDy).flatMap(row=>row.items);
    for(const item of items){
      if(invoiceDate(item.text)||/\d{1,2}:\d{2}/.test(item.text)||/@/.test(item.text))continue;
      for(const match of item.text.matchAll(/(?<![\da-z])[a-z]{0,3}\d+(?:[-/][a-z\d]+)*(?![\da-z])/gi)){
        if(match[0].length>20||match[0].length<2||item.x<placement.minX||item.x>placement.maxX)continue;
        candidates.push(field(match[0],[item,...cell.items.filter(other=>other!==item)],'invoice_title_geometry'));
      }
    }
  }
  const result=unique(candidates,'invoice_number');
  result.rawNumber=result.value;result.suggestedNumber=result.value;result.effectiveNumber=null;
  const verifiedPrefix=profile.verifiedNumberPrefixes?.find(prefix=>result.value?.startsWith(prefix)&&/^\d+$/.test(result.value.slice(prefix.length)));
  if(verifiedPrefix){result.value=result.value.slice(verifiedPrefix.length);result.suggestedNumber=result.value;result.method='verified_supplier_prefix';result.normalizationVerified=true;}
  else if(result.value&&/[a-z]/i.test(result.value)){result.status='review';result.reason='alphanumeric_number_review';}
  if(result.value&&profile.numberPrefixReview&&result.value.startsWith(profile.numberPrefixReview)){
    result.alternative=result.value.slice(profile.numberPrefixReview.length);result.status='review';result.reason='supplier_prefix_not_verified';
  }
  return result;
}
function invoiceDay(cells,titles,profile){
  const preferred=['תאריךחשבונית','תאריךהזיכוי','תאריךרישום','תאריך'];
  for(const key of preferred){
    const anchors=cells.filter(cell=>cell.page===1&&cell.y<cell.pageHeight*.5&&(cell.key===key||cell.key.startsWith(key)&&/\d/.test(cell.key.slice(key.length))));
    const candidates=[];
    for(const anchor of anchors){
      const items=nearbyItems(cells,anchor,4).filter(item=>invoiceDate(item.text));
      items.sort((a,b)=>Math.abs(a.x+a.width-anchor.x)-Math.abs(b.x+b.width-anchor.x));
      if(items[0])candidates.push(field(invoiceDate(items[0].text),[items[0],...anchor.items.filter(item=>item!==items[0])]));
    }
    if(candidates.length)return unique(candidates,'invoice_date');
  }
  if(profile.layout==='morning'){
    const titleY=Math.min(...titles.map(row=>row.cell.y));
    return unique(cells.filter(cell=>cell.page===1&&cell.y>titleY&&cell.y<titleY+70).flatMap(cell=>cell.items)
      .filter(item=>invoiceDate(item.text)).map(item=>field(invoiceDate(item.text),[item],'issuer_header_date')),'invoice_date');
  }
  return missing('invoice_date');
}
function allocation(cells){
  const anchors=cells.filter(cell=>/מספרהקצאה|מסהקצאה|מהקצאה|הקצאהמספר/.test(cell.key)),candidates=[];
  for(const anchor of anchors){
    for(const item of nearbyItems(cells,anchor,3)){
      if(Math.abs(item.x-anchor.x)>220)continue;
      const matches=[...item.text.matchAll(/(?<!\d)\d{9}(?!\d)/g)];
      for(const match of matches)candidates.push(field(match[0],[item,...anchor.items.filter(other=>other!==item)],'allocation_label_geometry'));
    }
  }
  const result=unique(candidates,'allocation_number');result.officiallyValidated=false;return result;
}
export async function recognizeInvoice(extraction,{profiles=INVOICE_SUPPLIER_PROFILES}={}){
  const empty=()=>({supplier:missing('supplier'),documentType:missing('document_type'),invoiceNumber:missing('invoice_number'),date:missing('invoice_date'),
    net:missing('money'),vat:missing('money'),gross:missing('money'),allocationNumber:missing('allocation_number'),currency:missing('currency')});
  const output={version:1,source:'local_pdf',profile:null,fields:empty(),warnings:[],pageCount:extraction.pages.length,requiresReview:true};
  if(!extraction.hasText){output.warnings.push('no_usable_text');return output;}
  const cells=cellsOf(extraction.pages),header=extraction.pages[0],possible=new Map(),allKey=cells.map(cell=>cell.key).join('');
  const recipientY=Math.min(...cells.filter(cell=>cell.page===1&&/^(?:לכבוד|לידי)/.test(cell.key)).map(cell=>cell.y));
  for(const item of header.items)for(const match of item.text.matchAll(/(?<!\d)\d{9}(?!\d)/g)){
    const key=match[0]+':'+item.index;if(!possible.has(key))possible.set(key,{taxId:match[0],item});
  }
  const matched=[];
  for(const {taxId,item}of possible.values()){
    const hash=await digest('supplier-tax:'+taxId);
    for(const profile of profiles){
      const footer=profile.issuerRegion==='footer';
      const inRegion=footer?item.y>header.height*.8:item.y<header.height*.35&&(profile.layout==='sap'?item.x<200:item.y<recipientY);
      const branded=profile.aliases.some(alias=>allKey.includes(invoiceLabelKey(alias)));
      const labeledFooter=footer&&cells.some(cell=>cell.page===1&&cell.items.includes(item)&&/עמ|עוסקמורשה/.test(cell.key))&&cells.some(cell=>cell.page===1&&cell.y<header.height*.1&&/^חשבונית(?:מס|זיכוי)מרכזת$/.test(cell.key));
      if(profile.issuerTaxHash===hash&&inRegion&&(branded||labeledFooter)&&!matched.some(row=>row.profile.id===profile.id))matched.push({profile,taxId,item});
    }
  }
  if(matched.length!==1){output.warnings.push(matched.length?'ambiguous_supplier':'unknown_supplier');return output;}
  const {profile,taxId,item}=matched[0];output.profile=profile.id;
  output.fields.supplier={...field(taxId,[item],'issuer_tax_and_profile','review','canonical_supplier_pending'),name:profile.title,nameSource:'profile',canonicalVerified:false};
  const {result,titles}=headerType(cells);output.fields.documentType=result;
  output.fields.invoiceNumber=invoiceNumber(cells,titles,profile);output.fields.date=invoiceDay(cells,titles,profile);
  output.fields.allocationNumber=allocation(cells);
  const netLabels=profile.layout==='tbi'||profile.layout==='morning'?[/^סהכ$/]:profile.layout==='priority'?[/^מחיראחריהנחה$/,/^מחירכולל$/]:profile.layout==='sap'?[/^סךהכולאחריהנחה$/]:[/^סהכלפנימעמ$/];
  const grossLabels=profile.layout==='bina'?[/^לתשלוםבשח$/]:profile.layout==='sap'?[/^סכוםלתשלום$/,/^סהכלתשלום$/]:profile.layout==='priority'?[/^סהככוללמעמ$/,/^סהכמחיר$/]:profile.layout==='priority-print'?[/^סהככללי$/]:[/^סהכלתשלום(?:בשח)?$/];
  // A trailing annex is not necessarily the invoice's summary page. Choose the
  // last page containing BOTH explicit VAT and gross, never mix page totals.
  let summary=null;
  for(const page of [...new Set(cells.map(cell=>cell.page))].sort((a,b)=>b-a)){
    const local=cells.filter(cell=>cell.page===page);
    const vat=readMoney(local,[/^מעמ(?:\d|$)/,...(profile.layout==='hash'?[/^מע$/]:[])]),gross=readMoney(local,grossLabels);
    if(vat.value!==null&&gross.value!==null){summary={net:profile.derivedNet?missing('net_requires_derivation'):readMoney(local,netLabels),vat,gross,page};break;}
  }
  const {net,vat,gross}=summary||{net:missing('summary'),vat:missing('summary'),gross:missing('summary')};
  output.summaryPage=summary?.page||null;
  if(net.value===null&&Number.isSafeInteger(gross.value)&&Number.isSafeInteger(vat.value)&&gross.value>=vat.value){
    Object.assign(net,{value:gross.value-vat.value,status:'review',method:'gross_minus_explicit_vat',reason:'computed_net',sources:[...gross.sources,...vat.sources]});
  }
  Object.assign(output.fields,{net,vat,gross});
  if(!output.fields.invoiceNumber.value||!result.value)for(const row of [net,vat,gross]){row.status='review';row.reason='document_identity_unresolved';}
  if([net,vat,gross].every(row=>Number.isSafeInteger(row.value))&&(net.value<0||vat.value<0||gross.value<=0||net.value+vat.value!==gross.value)){
    for(const row of [net,vat,gross]){row.status='review';row.reason='amounts_inconsistent';}output.warnings.push('amounts_inconsistent');
  }
  const currency=extraction.pages.flatMap(page=>page.items).find(item=>/₪|ש["'`״]?ח|\bILS\b/u.test(item.text));
  if(currency)output.fields.currency=field('ILS',[currency],'printed_currency');
  output.allocationPolicy=allocationPolicy({date:output.fields.date.value,documentType:result.value,netCents:net.value,vatCents:vat.value});
  if(output.allocationPolicy.status==='check_business_conditions'&&!output.fields.allocationNumber.value)output.warnings.push('allocation_missing_check_conditions');
  for(const [name,row]of Object.entries(output.fields))if(row.status!=='verified'&&!(name==='allocationNumber'&&!row.value&&output.allocationPolicy.status!=='check_business_conditions'))output.warnings.push(name+':'+(row.reason||row.status));
  return output;
}
