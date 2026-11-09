import {completeSupabaseMfa,verifySupabaseFactor,verifiedFactors} from './supabase-mfa.js';

function enrollmentQrUrl(value) {
  // Auth returns a verbose SVG with an XML declaration, which can exceed 350 KB.
  if(typeof value!=='string'||value.length>1_048_576)return '';
  const source=value.trim().replace(/^<\?xml\s+[^?]*\?>/i,'');
  const start=source.search(/<svg(?:\s|>)/i);
  if(start<0||source.slice(0,start).replace(/<!--[\s\S]*?-->/g,'').trim())return '';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source.slice(start));
}

// This page owns only a temporary Auth session. It never opens business data,
// writes app credentials, or persists passwords, OTPs or enrollment secrets.
export function mountAccountSecurity(root, config, {fetchRequest=globalThis.fetch, confirmAction=null}={}) {
  const find=id=>root.querySelector('#'+id);
  const controls=[...root.querySelectorAll('button')];
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  let session=null,pendingLogin=null,pendingFactor=null,disposed=false,busy=false,cancelConfirmation=null;
  function confirmRemoval(text){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog'),label=document.createElement('p');
      const accept=document.createElement('button'),cancel=document.createElement('button');
      let settled=false;
      function finish(accepted){if(settled)return;settled=true;cancelConfirmation=null;dialog.close();dialog.remove();resolve(accepted)}
      label.textContent=text;dialog.setAttribute('aria-label','אישור הסרת גורם אימות');
      accept.type=cancel.type='button';accept.textContent='הסר';cancel.textContent='ביטול';
      accept.addEventListener('click',()=>finish(true));cancel.addEventListener('click',()=>finish(false));
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});
      cancelConfirmation=()=>finish(false);dialog.append(label,accept,cancel);root.append(dialog);dialog.showModal();cancel.focus();
    });
  }
  const headers=token=>({apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})});
  function message(text,error=false){find('securityMessage').textContent=text;find('securityMessage').classList.toggle('error',error)}
  function clearSecret(){pendingFactor=null;find('securityQr').hidden=true;find('securityQr').removeAttribute('src');find('securitySecret').textContent='';find('securitySetupCode').value='';find('securitySetup').hidden=true}
  find('securityQr').addEventListener('error',()=>{find('securityQr').hidden=true});
  function reset(){cancelConfirmation?.();session=null;pendingLogin=null;clearSecret();find('securityPassword').value='';find('securityLoginCode').value='';find('securityEmail').readOnly=false;find('securityPasswordGroup').hidden=false;find('securityLoginButton').textContent='התחבר';find('securityLogin').hidden=false;find('securityManage').hidden=true;find('securityFactors').replaceChildren()}
  async function request(route,body,token=session?.access_token,method=body===undefined?'GET':'POST'){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetchRequest(config.url+'/auth/v1/'+route,{method,headers:headers(token),...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw Error('הפעולה לא הושלמה. יש לבדוק את הפרטים ואת גורמי האימות הקיימים ולנסות שוב.');
      if(disposed)throw Error('העמוד נסגר. יש להתחבר מחדש.');
      return result;
    }finally{clearTimeout(timer)}
  }
  function factorChoices(error){
    if(!Array.isArray(error?.factors)||!error.factors.length)return;
    const select=find('securityLoginFactor');select.replaceChildren();
    if(error.factors.length>1){const option=document.createElement('option');option.value='';option.textContent='בחר אפליקציית אימות';select.append(option)}
    for(const factor of error.factors){const option=document.createElement('option');option.value=factor.id;option.textContent=factor.name;select.append(option)}
    find('securityFactorChoice').hidden=error.factors.length<2;
  }
  async function refresh(){
    const profile=await request('user');
    if(profile?.id!==session.user.id)throw Error('זהות החשבון השתנתה. יש להתחבר מחדש.');
    session={...session,user:profile};
    const factors=Array.isArray(profile.factors)?profile.factors:[],list=find('securityFactors');list.replaceChildren();
    find('securityStatus').textContent=verifiedFactors(profile).length?'אימות דו־שלבי מופעל':'אימות דו־שלבי עדיין אינו מופעל';
    for(const factor of factors){
      if(!uuid.test(factor.id))continue;
      const item=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');
      label.textContent=String(factor.friendly_name||'אפליקציית אימות')+' — '+(factor.status==='verified'?'מאומת':'רישום שלא הושלם');
      remove.type='button';remove.textContent=factor.status==='verified'?'הסר גורם':'בטל רישום';
      remove.addEventListener('click',()=>run(async()=>{
        const accepted=await (confirmAction||confirmRemoval)(factor.status==='verified'?'הסרת גורם האימות מפחיתה את ההגנה על החשבון. להסיר?':'לבטל את הרישום שלא הושלם?');
        if(!accepted||disposed)return;
        await request('factors/'+factor.id,undefined,session.access_token,'DELETE');await refresh();message('גורם האימות הוסר.');
      }));
      item.append(label,remove);list.append(item);
    }
    find('securityLogin').hidden=true;find('securityManage').hidden=false;
  }
  async function run(action){
    if(busy||disposed)return;
    busy=true;controls.forEach(button=>{button.disabled=true});root.setAttribute('aria-busy','true');
    try{await action()}catch(error){if(!disposed){factorChoices(error);message(error?.message||'האימות לא הושלם. יש לנסות שוב.',true)}}
    finally{busy=false;controls.forEach(button=>{button.disabled=false});find('securityEnroll').disabled=!!pendingFactor;root.removeAttribute('aria-busy')}
  }
  find('securityLogin').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(!config.url||!config.publishableKey)throw Error('גישה לענן אינה זמינה בכתובת זו. יש לפתוח את האתר המאושר.');
    if(!pendingLogin){
      const email=find('securityEmail').value.trim(),password=find('securityPassword').value;
      if(!email||!password)throw Error('יש להזין אימייל וסיסמה.');
      try{pendingLogin=await request('token?grant_type=password',{email,password},undefined)}finally{find('securityPassword').value=''}
      if(!pendingLogin?.user?.id||!pendingLogin.access_token){pendingLogin=null;throw Error('לא התקבל אישור התחברות תקין.')}
      find('securityEmail').readOnly=true;
    }
    try{
      const verified=await completeSupabaseMfa(pendingLogin,{url:config.url,headers,fetchRequest,code:find('securityLoginCode').value.trim(),factorId:find('securityLoginFactor').value});
      if(disposed)return;
      session=verified;
    }catch(error){find('securityPasswordGroup').hidden=true;find('securityLoginButton').textContent='אמת קוד';throw error}
    pendingLogin=null;find('securityLoginCode').value='';await refresh();message('החשבון אומת. פרטי הכניסה נשמרים בעמוד זה בלבד.');
  })});
  find('securityEnroll').addEventListener('click',()=>run(async()=>{
    if(pendingFactor)return;
    const factor=await request('factors',{factor_type:'totp',friendly_name:'נתונים '+new Date().toISOString()});
    const created=factor?.type==='totp'&&typeof factor.id==='string'&&uuid.test(factor.id);
    const secret=factor?.totp?.secret;
    if(!created||typeof secret!=='string'||!/^[A-Z2-7]{16,128}$/.test(secret)){
      if(created){
        try{await request('factors/'+factor.id,undefined,session.access_token,'DELETE');await refresh()}catch{}
      }
      throw Error('לא התקבל מפתח רישום תקין. אפשר לבטל רישום שלא הושלם ולנסות שוב.');
    }
    const qr=enrollmentQrUrl(factor.totp.qr_code);
    // Render provider SVG only as an inert image, never HTML or a remote QR service.
    if(qr)find('securityQr').src=qr;
    find('securityQr').hidden=!qr;
    find('securitySecret').textContent=secret;pendingFactor=factor.id;
    find('securitySetup').hidden=false;message('הוסף את החשבון באפליקציה באמצעות סריקה או מפתח ההגדרה, והזן את הקוד שקיבלת.');
  }));
  find('securitySetup').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(!pendingFactor)throw Error('יש להתחיל רישום של אפליקציית אימות.');
    const verified=await verifySupabaseFactor(session,{factorId:pendingFactor,code:find('securitySetupCode').value.trim(),url:config.url,headers,fetchRequest});
    if(disposed)return;
    session=verified;
    clearSecret();await refresh();message('אימות דו־שלבי הופעל. יש להתחבר מחדש באתרים ובמחשבים האחרים עם קוד מהאפליקציה.');
  })});
  find('securityCancelSetup').addEventListener('click',()=>run(async()=>{
    if(pendingFactor)await request('factors/'+pendingFactor,undefined,session.access_token,'DELETE');
    clearSecret();await refresh();message('הרישום בוטל.');
  }));
  find('securityLogout').addEventListener('click',()=>{reset();message('פרטי האימות נמחקו מזיכרון העמוד.')});
  const dispose=()=>{disposed=true;reset();};
  globalThis.addEventListener?.('pagehide',dispose,{once:true});
  return {dispose};
}
