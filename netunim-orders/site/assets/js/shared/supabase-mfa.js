const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function sessionClaims(token) {
  try {
    if (typeof token !== 'string' || token.length > 65536) return null;
    const value = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0))));
  } catch { return null; }
}
export function verifiedFactors(user) {
  return (Array.isArray(user?.factors) ? user.factors : []).filter(f => f?.status === 'verified');
}
function mfaError(code, message, factors = []) {
  return Object.assign(new Error(message), {code, factors:factors.map(f => ({id:f.id, name:String(f.friendly_name || 'אפליקציית אימות').slice(0,100)}))});
}

// Auth's password response includes verified factors. This client flow never
// grants data access itself: RLS/RPC/Edge independently enforce assurance.
export async function completeSupabaseMfa(session, {code = '', factorId = '', url, headers, fetchRequest = globalThis.fetch, timeoutMs = 15000} = {}) {
  const factors = verifiedFactors(session?.user);
  if (!factors.length) return session;
  const owner = session.user.id, claims = sessionClaims(session.access_token);
  if (claims?.sub === owner && claims.aal === 'aal2') return session;
  const totp = factors.filter(f => f.factor_type === 'totp' && uuid.test(f.id));
  if (!totp.length) throw mfaError('mfa_unsupported_factor', 'יש להשתמש בגורם TOTP מאומת או בתהליך שחזור החשבון.');
  const selected = factorId ? totp.find(f => f.id === factorId) : totp.length === 1 ? totp[0] : null;
  if (!selected) throw mfaError('mfa_factor_required', 'יש לבחור אפליקציית אימות.', totp);
  if (!/^[0-9]{6}$/.test(code)) throw mfaError('mfa_code_required', 'יש להזין קוד בן שש ספרות מאפליקציית האימות.', totp);
  try { return await verifySupabaseFactor(session,{code,factorId:selected.id,url,headers,fetchRequest,timeoutMs}); }
  catch(error){if(error?.code?.startsWith('mfa_'))error.factors=totp.map(f=>({id:f.id,name:String(f.friendly_name||'אפליקציית אימות').slice(0,100)}));throw error;}
}

export async function verifySupabaseFactor(session, {code, factorId, url, headers, fetchRequest=globalThis.fetch, timeoutMs=15000} = {}) {
  const owner=session?.user?.id;
  if(!owner||!uuid.test(factorId)||!/^[0-9]{6}$/.test(code))throw mfaError('mfa_code_required','יש להזין קוד בן שש ספרות מאפליקציית האימות.');
  async function post(action, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchRequest(`${url}/auth/v1/factors/${factorId}/${action}`, {method:'POST', headers:headers(session.access_token),
        body:JSON.stringify(body), credentials:'omit', redirect:'error', cache:'no-store', signal:controller.signal});
      const result = await response.json().catch(() => null);
      if (!response.ok) throw mfaError('mfa_verification_failed', 'אימות הקוד נכשל. יש לבדוק את הקוד ואת השעה בטלפון ולנסות שוב.');
      return result;
    } catch (error) {
      if (error?.code?.startsWith('mfa_')) throw error;
      throw mfaError('mfa_connection_failed', 'לא ניתן להשלים את האימות כרגע. יש לנסות שוב.');
    } finally { clearTimeout(timer); }
  }
  const challenge = await post('challenge', {});
  if (!uuid.test(challenge?.id)) throw mfaError('mfa_invalid_receipt', 'שרת האימות לא החזיר בקשת אימות תקינה.');
  const upgraded = await post('verify', {challenge_id:challenge.id, code});
  const proof = sessionClaims(upgraded?.access_token);
  if (proof?.sub !== owner || proof?.aal !== 'aal2' || upgraded.user && upgraded.user.id !== owner ||
      typeof upgraded.refresh_token !== 'string' || !upgraded.refresh_token || !Number.isFinite(upgraded.expires_in) || upgraded.expires_in <= 0) {
    throw mfaError('mfa_invalid_receipt', 'שרת האימות לא אישר את זהות המשתמש והאימות הנוסף.');
  }
  return {...session, ...upgraded, user:upgraded.user || session.user};
}
