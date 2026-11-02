import {createMorningVatSummary} from './morning-vat-summary.js';
import {expenseBimonth} from '../../core/morning-report-period.js';
import {expenseMoney} from './morning-expense-table.js';
import {esc} from '../../core/values.js';

export function createExpenseVatSummary(ports){
  const summary=createMorningVatSummary(ports);
  function markup(){
    const {periodKey:key,status,cents}=summary.snapshot();
    const label=status==='ready'?(cents<0?'מע״מ להחזר':'מע״מ לתשלום'):'מע״מ לתשלום';
    const detail=!key?'בחרו תקופת דיווח':status==='loading'?'טוען סיכום ממורנינג…':status==='ready'?expenseBimonth(key+'-01').label:'הסיכום אינו זמין · אפשר לרענן את הרשימה';
    return `<div class="morning-expense-vat-summary" data-expense-vat-summary role="status" aria-live="polite"><strong>${label}: <bdi>${status==='ready'?esc(expenseMoney(Math.abs(cents))):'—'}</bdi></strong><small>${esc(detail)}</small></div>`;
  }
  return {...summary,markup};
}
