import {completeSupabaseMfa,verifySupabaseFactor,verifiedFactors} from './supabase-mfa.js';

// This page owns only a temporary Auth session. It never opens business data,
// writes app credentials, or persists passwords, OTPs or enrollment secrets.
export function mountAccountSecurity(root, config, {fetchRequest=globalThis.fetch, confirmAction=message=>globalThis.confirm(message)}={}) {
  const find=id=>root.querySelector('#'+id);
  const controls=[...root.querySelectorAll('button')];
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  let session=null,pendingLogin=null,pendingFactor=null,disposed=false,busy=false;
  const headers=token=>({apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})});
  function message(text,error=false){find('securityMessage').textContent=text;find('securityMessage').classList.toggle('error',error)}
  function clearSecret(){pendingFactor=null;find('securityQr').removeAttribute('src');find('securitySecret').textContent='';find('securitySetupCode').value='';find('securitySetup').hidden=true}
  function reset(){session=null;pendingLogin=null;clearSecret();find('securityPassword').value='';find('securityLoginCode').value='';find('securityEmail').readOnly=false;find('securityPasswordGroup').hidden=false;find('securityLoginButton').textContent='התחבר';find('securityLogin').hidden=false;find('securityManage').hidden=true;find('securityFactors').replaceChildren()}
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
        if(!confirmAction(factor.status==='verified'?'הסרת גורם האימות מפחיתה את ההגנה על החשבון. להסיר?':'לבטל את הרישום שלא הושלם?'))return;
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
    finally{busy=false;controls.forEach(button=>{button.disabled=false});root.removeAttribute('aria-busy')}
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
    const factor=await request('factors',{factor_type:'totp',friendly_name:'נתונים '+new Date().toISOString()});
    if(!uuid.test(factor?.id)||typeof factor.totp?.secret!=='string'||factor.totp.secret.length>256||typeof factor.totp?.qr_code!=='string'||factor.totp.qr_code.length>131072)throw Error('לא התקבל גורם אימות תקין.');
    const qr=factor.totp.qr_code;
    if(!qr.startsWith('data:image/svg+xml')&&!/^\s*<svg\b/i.test(qr))throw Error('לא התקבל קוד רישום תקין.');
    // Render provider SVG only as an inert image, never HTML or a remote QR service.
    find('securityQr').src=qr.startsWith('data:image/svg+xml')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);
    find('securitySecret').textContent=factor.totp.secret;pendingFactor=factor.id;
    find('securitySetup').hidden=false;message('סרוק בטלפון, שמור אפשרות שחזור במקום בטוח והזן קוד לאישור.');
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
