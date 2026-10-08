// Access-token refresh keeps the login scope. Explicit login/logout replaces
// it, even if the next login belongs to the same user.
/** @param {{loadSession: () => {user?: {id?: string}}|null}} ports */
export function createAuthenticatedAccountScope({loadSession}){
  let owner=null,epoch=0;
  const identity=value=>String(value?.user?.id||'').trim()||null;
  function observe(value){const live=identity(value);if(live!==owner){owner=live;epoch+=1}return {owner,epoch}}
  function current(){return observe(loadSession())}
  function replace(value,{refresh=false}={}){
    const live=identity(value);
    if(!refresh||live!==owner)epoch+=1;
    owner=live;
  }
  return {current,replace};
}
