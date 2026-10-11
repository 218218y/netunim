import {creditDetailChargeCycleKey,creditDetailMonthlySections,creditUpcomingCycleHeadingData} from './credit-detail-controls.js';

// Applications own the row contents and column count; this renderer owns only
// the common cycle headings and the ordering of foreign/uncertain/known rows.
export function creditCycleRowsMarkup(items,{colspan,rowMarkup,escapeHtml,formatDate}){
  let previous='';
  return items.map(row=>{
    const cycleKey=creditDetailChargeCycleKey(row);
    const divider=cycleKey&&cycleKey!==previous
      ?`<tr class="credit-detail-cycle-divider upcoming"><td colspan="${colspan}"><b>${escapeHtml(creditUpcomingCycleHeadingData(row,formatDate))}</b></td></tr>`:'';
    if(cycleKey)previous=cycleKey;
    return divider+rowMarkup(row);
  }).join('');
}

export function creditUpcomingSectionsMarkup(items,presentation){
  const {colspan,rowMarkup}=presentation;
  const {foreign,uncertain,regular}=creditDetailMonthlySections(items);
  const foreignMarkup=foreign.length
    ?`<tr class="credit-detail-cycle-divider certain foreign"><td colspan="${colspan}"><b>עסקאות חו״ל / מט״ח</b><small>עסקאות בחיוב מיידי משויכות למחזור הכרטיס שבין חיוב חודשי אחד לבא; בשורה נשמר מועד החיוב בפועל.</small></td></tr>${foreign.map(rowMarkup).join('')}`:'';
  const uncertainMarkup=uncertain.length
    ?`<tr class="credit-detail-cycle-divider uncertain"><td colspan="${colspan}"><b>מחזור לא ודאי</b><small>עסקאות שמועד החיוב הסופי שלהן טרם נקבע; מוצגות אחרי עסקאות המט״ח ולפני המחזורים הידועים.</small></td></tr>${uncertain.map(rowMarkup).join('')}`:'';
  return foreignMarkup+uncertainMarkup+creditCycleRowsMarkup(regular,presentation);
}
