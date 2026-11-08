// Server-only protection. The keyring lives in Edge secrets, never PostgreSQL.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const prefix = 'ngc1';
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const services = new Set(['calendar', 'drive']);
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new GoogleCredentialError();
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (b64url(bytes) !== value) throw new GoogleCredentialError();
  return bytes;
}
export class GoogleCredentialError extends Error {
  constructor() { super('Google OAuth credential protection unavailable'); this.name = 'GoogleCredentialError'; }
}

export function createGoogleCredentialVault({keyringJson, activeKeyId, audience, allowLegacy = false}) {
  let rawKeys;
  try {
    rawKeys = JSON.parse(keyringJson);
    if (!rawKeys || Array.isArray(rawKeys) || !keyPattern.test(activeKeyId) || !Object.hasOwn(rawKeys, activeKeyId) ||
        !audience || new URL(audience).origin !== audience || Object.keys(rawKeys).length > 8) throw Error();
    for (const [id, value] of Object.entries(rawKeys)) {
      if (!keyPattern.test(id) || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Error();
      const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
      if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== value) throw Error();
      rawKeys[id] = bytes;
    }
  } catch { throw new GoogleCredentialError(); }
  const material = new Map();
  function keys(id) {
    if (!Object.hasOwn(rawKeys, id)) throw new GoogleCredentialError();
    if (!material.has(id)) material.set(id, (async () => {
      const root = await crypto.subtle.importKey('raw', rawKeys[id], 'HKDF', false, ['deriveKey']);
      const derive = (purpose, algorithm, usages) => crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256',
        salt:encoder.encode('netunim-google-oauth-v1'), info:encoder.encode(purpose)}, root, algorithm, false, usages);
      return {aes:await derive('credential-encryption', {name:'AES-GCM', length:256}, ['encrypt', 'decrypt']),
        pkce:await derive('pkce-verifier', {name:'HMAC', hash:'SHA-256', length:256}, ['sign'])};
    })());
    return material.get(id);
  }
  function binding(context, id) {
    if (!services.has(context?.service) || typeof context?.ownerId !== 'string' || !context.ownerId || context.ownerId.length > 128) throw new GoogleCredentialError();
    return encoder.encode(JSON.stringify([prefix, id, audience, context.service, context.ownerId]));
  }
  async function seal(token, context) {
    try {
      if (typeof token !== 'string' || !token || token.length > 8192) throw Error();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128,
        additionalData:binding(context, activeKeyId)}, (await keys(activeKeyId)).aes, encoder.encode(token));
      return [prefix, activeKeyId, b64url(iv), b64url(new Uint8Array(ciphertext))].join('.');
    } catch { throw new GoogleCredentialError(); }
  }
  async function open(value, context) {
    try {
      binding(context, activeKeyId);
      if (typeof value !== 'string' || !value || value.length > 16384) throw Error();
      if (!value.startsWith(prefix + '.')) {
        if (allowLegacy === true && !value.startsWith('ngc') && value.length <= 8192) return value;
        throw Error();
      }
      const parts = value.split('.');
      if (parts.length !== 4 || !keyPattern.test(parts[1])) throw Error();
      const iv = unbase64url(parts[2]), ciphertext = unbase64url(parts[3]);
      if (iv.length !== 12 || ciphertext.length < 17) throw Error();
      const plaintext = await crypto.subtle.decrypt({name:'AES-GCM', iv, tagLength:128,
        additionalData:binding(context, parts[1])}, (await keys(parts[1])).aes, ciphertext);
      return decoder.decode(plaintext);
    } catch { throw new GoogleCredentialError(); }
  }
  function newState() {
    return activeKeyId + '.' + Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
  }
  // A PRF over a fresh 256-bit state yields an unpredictable 43-character verifier.
  // Domain-separated keys keep the verifier server-only without a plaintext DB column.
  async function proof(state, context, redirectUri) {
    try {
      const parts = String(state).split('.');
      if (parts.length !== 2 || !keyPattern.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || !redirectUri) throw Error();
      const data = encoder.encode(JSON.stringify([decoder.decode(binding(context, parts[0])), redirectUri, state]));
      const verifier = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', (await keys(parts[0])).pkce, data)));
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
      return {verifier, challenge};
    } catch { throw new GoogleCredentialError(); }
  }
  return Object.freeze({seal, open, newState, proof,
    needsRewrap:value => typeof value !== 'string' || !value.startsWith(prefix + '.' + activeKeyId + '.')});
}
