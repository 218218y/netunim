// Auth validates the JWT before its claims are used. Look up omitted factors
// using the authenticated user's ID and the existing server-only Auth client.
/**
 * @template {{id: string, factors?: unknown}} User
 * @param {{getUser(token:string): Promise<{data?: {user?: User|null}|null, error?: unknown}>}} auth
 * @param {{mfa:{listFactors(params:{userId:string}): Promise<{data?: {factors?:unknown}|null, error?:unknown}>}}|undefined} admin
 * @param {string} token
 * @returns {Promise<User|null>}
 */
export async function getMfaAssuredUser(auth, admin, token) {
  if (typeof token !== 'string' || !token || token.length > 65536) return null;
  try {
    const {data, error} = await auth.getUser(token);
    const user = data?.user;
    if (error || typeof user?.id !== 'string' || !user.id) return null;

    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !part)) return null;
    const value = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
    if (claims.sub !== user.id || (claims.aal !== 'aal1' && claims.aal !== 'aal2')) return null;

    let factors = user.factors;
    if (factors === undefined) {
      // Auth may omit factors for an unenrolled user. Only an explicit,
      // successful list response establishes that there are no verified factors.
      const result = await admin?.mfa.listFactors({userId: user.id});
      if (!result || result.error) return null;
      factors = result.data?.factors;
    }
    if (!Array.isArray(factors) || factors.some(factor =>
      typeof factor?.id !== 'string' || !factor.id ||
      (factor.status !== 'verified' && factor.status !== 'unverified'))) return null;
    if (claims.aal === 'aal1' && factors.some(factor => factor.status === 'verified')) return null;
    return user;
  } catch {
    return null;
  }
}
