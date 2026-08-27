import {esc} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiConnection({session, tab, files, setCloudHeaderStatus, storeSupaSession, openSupabaseLoginModal, openCloudUsingSavedSession, supaProjectRef, supaConfigured, getRememberedHandle, ensureDirectoryFile, loadState, render}){
function configureCloudConnectButton(label='פתח קופה מהענן',action='open'){
  session.cloudConnectAction=action;
  const b=document.getElementById('openCloud');
  if(b)b.textContent=label;
}

async function handleCloudConnectButton(){
  if(session.cloudConnectAction==='reauth'){
    storeSupaSession(null);
    session.cloudAuthNoDocument=false;
    setCloudHeaderStatus('off','ענן: נדרשת התחברות');
    openSupabaseLoginModal('open');
    return;
  }
  await openCloudUsingSavedSession({interactive:true});
}

function showSecondaryTabGuard(){if(tab.primaryTab)return;document.getElementById('connectScreen').style.display='flex';setConnectUI({title:'ניהול הקופה פתוח בלשונית אחרת',text:'כדי למנוע שתי כתיבות מקבילות לאותה קופה, רק לשונית אחת יכולה לערוך ולשמור.',note:'סגור את הלשונית האחרת או רענן את העמוד אחרי שסגרת אותה. הלשונית הזו לא תבצע שמירות כל עוד הנעילה תפוסה.'})}

function setConnectUI({title,text,note,showLast=false,showChoose=false,showFile=false,showCloud=false}){
  document.getElementById('connectTitle').textContent=title;
  document.getElementById('connectText').innerHTML=text;
  document.getElementById('connectNote').innerHTML=note||'';
  const actions=document.getElementById('connectActions');
  actions.style.display=(showLast||showChoose||showFile||showCloud)?'flex':'none';
  document.getElementById('openLastFolder').style.display=showLast?'inline-block':'none';
  document.getElementById('chooseFolder').style.display=showChoose?'inline-block':'none';
  document.getElementById('chooseDataFile').style.display=showFile?'inline-block':'none';
  document.getElementById('openCloud').style.display=showCloud?'inline-block':'none';
}

function showFirstRun(){
  configureCloudConnectButton('פתח קופה מהענן','open');
  setConnectUI({title:'פתיחת קופת העסק',text:'אפשר לעבוד מתיקייה מקומית ניידת או לפתוח את אותה קופה מהענן Supabase.',note:`לתיקייה מקומית בוחרים פעם אחת את תיקיית <b>ניהול_קופה_ניידת</b>. לענן מתחברים פעם אחת בכל מחשב; לאחר התחברות מוצלחת ה-Session נשמרת ומתרעננת אוטומטית. ${supaConfigured()?`פרויקט: <b>${esc(supaProjectRef())}</b>.`:''}`,showChoose:true,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
}

function showRememberedFolderPrompt(note='הדפדפן דורש אישור מחדש לגישה לתיקייה השמורה.'){
  configureCloudConnectButton('פתח קופה מהענן','open');
  setConnectUI({title:'הקופה השמורה מוכנה',text:'התיקייה כבר שמורה. לחץ פעם אחת כדי לאשר את הגישה מחדש — אין צורך לבחור אותה מחדש.',note,showLast:true,showChoose:true,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
}

async function tryAutoOpenRemembered(){
  const last=await getRememberedHandle();
  if(!last)return false;
  try{
    const permission=await last.queryPermission?.({mode:'readwrite'});
    if(permission==='granted'){
      files.rootDirHandle=last;session.connectionMode='directory';files.dataFileHandle=await ensureDirectoryFile(last);await loadState();document.getElementById('connectScreen').style.display='none';render();return true;
    }
    showRememberedFolderPrompt();
    return true;
  }catch(e){console.error(e);showRememberedFolderPrompt('נמצאה תיקייה שמורה, אך לא ניתן היה להתחבר אליה אוטומטית. נסה לפתוח אותה מחדש.');return true}
}

return { configureCloudConnectButton, handleCloudConnectButton, showSecondaryTabGuard, setConnectUI, showFirstRun, showRememberedFolderPrompt, tryAutoOpenRemembered };
}
