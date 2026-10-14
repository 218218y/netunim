// @ts-check

/** Remove one-time OAuth result parameters before any Calendar UI renders. */
export function consumeCalendarOAuthReturn(){
  if(!globalThis.location?.href||!globalThis.history?.replaceState)return {status:'',code:''};
  let url;try{url=new URL(globalThis.location.href)}catch{return {status:'',code:''}}
  const status=String(url.searchParams.get('calendar_oauth')||''),code=String(url.searchParams.get('calendar_oauth_code')||'');
  if(!status)return {status,code};
  url.searchParams.delete('calendar_oauth');url.searchParams.delete('calendar_oauth_code');
  globalThis.history.replaceState(globalThis.history.state,'',url.pathname+url.search+url.hash);
  return {status,code};
}

export function calendarOAuthReturnUrl(){
  if(!globalThis.location?.href)return '';
  const url=new URL(globalThis.location.href);url.hash='';
  url.searchParams.delete('calendar_oauth');url.searchParams.delete('calendar_oauth_code');return url.toString();
}
