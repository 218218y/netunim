import {esc} from '../core/values.js';
import {documentAuthError,documentPairingHtml} from './document-search-connection-view.js';

function errorDetails(error,retry,hint=''){
  const code=String(error?.code||'');
  return `<p>${esc(error?.message||'לא ניתן להשלים את הבקשה.')}${hint?`<br>${esc(hint)}`:''}</p>${code?`<small>${esc(code)}</small>`:''}<button type="button" class="document-preview-open" data-document-retry="${esc(retry)}">נסה שוב</button>`;
}

export function documentSearchErrorHtml(error,{provider='everything',retry='recent'}={}){
  if(documentAuthError(error))return documentPairingHtml({provider});
  const code=String(error?.code||''),hint=code==='DOCUMENT_BRIDGE_TIMEOUT'?'הבקשה הסתיימה ללא תשובה בזמן. אפשר לנסות שוב.':provider==='google-drive'?'בדוק שהאתר מחובר לענן, ש-Google Drive API פעיל ושהרשאת Drive לא בוטלה.':code==='DOCUMENT_BRIDGE_UNAVAILABLE'?'ודא ש־Document Bridge מותקן ופועל במחשב זה.':code==='EVERYTHING_EXE_NOT_FOUND'?'ה־Bridge לא מצא את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי.':'בדוק ש־Everything פועל ושהאינדקס שלו מחזיר את אותה שאילתה בחלון Everything.';
  return `<div class="global-search-empty document-search-error"><div class="global-search-empty-icon">!</div><b>חיפוש הקבצים אינו זמין</b>${errorDetails(error,retry,hint)}</div>`;
}

export function documentPreviewErrorHtml(error,{matches=false}={}){
  return `<div class="${matches?'document-preview-match-loading':'document-preview-empty'} error"><span>!</span><b>${matches?'איתור ההתאמות נכשל':'התצוגה המקדימה נכשלה'}</b>${errorDetails(error,matches?'matches':'preview')}</div>`;
}
