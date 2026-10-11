import {esc} from '../../core/values.js';

export function bankLocalSnapshotNotice(state,{retry=false}={}){
  if(!state)return '';
  const saving=state.phase==='saving';
  return `<div class="notice warn" data-bank-local-snapshot role="status"><b>${saving?'צילום הבנק ממתין לאישור שמירה.':'צילום הבנק לא אושר לשמירה.'}</b> היתרות וחישובי התזרים המוצגים כוללים נתון זמני. ${esc(saving?'יש להמתין לסיום השמירה.':state.message)}${retry&&state.canRetry?'<button type="button" class="btn" data-action="retry-local-bank-snapshot">נסה לשמור את הצילום הקיים</button>':''}</div>`;
}
