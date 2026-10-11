import {esc} from '../../core/values.js';

export function automationWarningMarkup(warning,code){
  if(!warning)return '';
  return `<div class="finance-sync-detail warn" role="alert"><b>העדכון האוטומטי מושהה במחשב הזה</b><span>${esc(warning)}</span><small>נתונים שכבר נשמרו בענן נשארים תקפים. קוד: ${esc(code||'')}</small></div>`;
}
