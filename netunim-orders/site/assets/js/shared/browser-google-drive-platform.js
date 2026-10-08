// Browser I/O is constructed lazily; token and result caches stay in memory.
export function createBrowserGoogleDrivePlatform({
  fetchRequest=(...args)=>globalThis.fetch(...args),
  locationRef=globalThis.location,
  historyRef=globalThis.history,
  clock={now:()=>Date.now()},
  userAgent=globalThis.navigator?.userAgent||'',
}={}){
  return {fetchRequest,clock,userAgent,browser:{
    oauthReturn:consumeOAuthReturn(locationRef,historyRef),
    returnUrl:()=>locationRef?.href||'',
    navigate:url=>locationRef?.assign?.(url),
  }};
}

function consumeOAuthReturn(locationRef,historyRef){if(!locationRef?.href)return {status:'',code:''};let url;try{url=new URL(locationRef.href)}catch{return {status:'',code:''}}const status=String(url.searchParams.get('drive_oauth')||''),code=String(url.searchParams.get('drive_oauth_code')||'');if(!status)return {status:'',code:''};url.searchParams.delete('drive_oauth');url.searchParams.delete('drive_oauth_code');try{historyRef?.replaceState?.(historyRef.state,'',url.pathname+url.search+url.hash)}catch{}return {status,code}}
