import {esc} from '../core/values.js';

const DOCUMENT_AUTH_CODES=new Set(['DOCUMENT_BRIDGE_NOT_PAIRED','UNAUTHORIZED','google_drive_not_connected','google_drive_reconnect_required','google_drive_auth_required']);

export function documentAuthError(error){return DOCUMENT_AUTH_CODES.has(String(error?.code||''))}

export function documentProviderNoticeHtml(value){const note=String(value||'');return note?`<div class="document-provider-notice"><span>DRIVE</span>${esc(note)}</div>`:''}

export function documentLocalPairingHtml({required=false,provider='',hasToken=false}={}){
  if(!required||(provider!=='google-drive'&&!hasToken))return '';
  return '<div class="document-search-local-pairing"><div class="document-search-local-pairing-copy"><b>Document Bridge לא מחובר לדפדפן הזה</b><span>Google Drive יכול להמשיך לעבוד, אבל לחיפוש המקומי דרך Everything יש להזין את המפתח של ההתקנה הנוכחית.</span></div><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div></div>';
}

export function documentPairingHtml({provider='',fallbackFromLocal=false,compact=false}={}){
  if(provider==='google-drive'){
    if(compact)return '<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Google Drive.</div>';
    const reason=fallbackFromLocal?'הגישה המקומית אינה זמינה כרגע, ולכן האתר יעבור אוטומטית ל-Google Drive.':'במכשיר הזה החיפוש והתצוגה המקדימה משתמשים ישירות ב-Google Drive.';
    return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש ותצוגה מקדימה דרך Google Drive</b><p>${reason}</p><div class="document-search-pair"><button type="button" data-document-connect>חבר Google Drive</button></div><small>לאחר החיבור אפשר לחפש ולהציג PDF, Word, Excel ומסמכי Google נתמכים ישירות בתוך האתר. Refresh Token נשמר רק ב-Supabase.</small></div>`;
  }
  if(compact)return '<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Document Bridge במחשב זה.</div>';
  return '<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש מסמכים במחשב זה</b><p>Document Bridge עדיין לא משויך לדפדפן הזה. מתקינים אותו בנפרד בכל מחשב; המפתח שהמתקין מעתיק ללוח נשמר רק בדפדפן המקומי.</p><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>הקבצים ותוכן החיפוש נשארים במחשב ואינם מועלים לאתר או לענן.</small></div>';
}

export function documentIntroHtml({provider='',mode='everything'}={}){
  const content=mode==='content';
  if(provider==='google-drive')return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן ב-Google Drive':'חיפוש קבצים ב-Google Drive'}</b><p>${content?'הקלד לפחות שני תווים. Google Drive מחפש מילות אינדקס בתוך שם, מטא-דאטה ותוכן שהוא יודע לאנדקס.':'חיפוש שמות קבצים ותיקיות מתבצע דרך Google Drive API.'}</p></div>`;
  return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן':'חיפוש קבצים'}</b><p>${content?'הקלד לפחות שני תווים כדי לחפש מילים בתוך תוכן הקבצים דרך Everything.':'חיפוש קבצים ותיקיות דרך אותו אינדקס ותחביר של Everything.'}</p></div>`;
}
