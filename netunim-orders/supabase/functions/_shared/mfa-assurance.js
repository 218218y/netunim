// Call only AFTER Auth.getUser(token) succeeds. Decoding is not signature
// verification; Auth supplies that authority and the server-managed factor list.
export function hasUserMfaAssurance(user, token) {
  if (!user?.id) return false;
  if (!(Array.isArray(user.factors) && user.factors.some(f => f?.status === 'verified'))) return true;
  try {
    if (typeof token !== 'string' || token.length > 65536) return false;
    const value = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0))));
    return claims.sub === user.id && claims.aal === 'aal2';
  } catch { return false; }
}
