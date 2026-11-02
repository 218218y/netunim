// @ts-check
import {GoogleHttpError} from './google-http.js';

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return /** @type {Record<string, unknown>} */ (value);
}
function invalid() { return new GoogleHttpError('response', 'google_invalid_response'); }
/** @param {unknown} value */
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

/** Decode successful provider JSON before persistence or token publication.
 * @param {unknown} value
 * @returns {{access_token:string, expires_in:number, refresh_token:string, scope:string}}
 */
export function decodeGoogleToken(value) {
  const data = record(value), access_token = text(data.access_token), expires_in = data.expires_in;
  if (!access_token || data.error !== undefined || typeof expires_in !== 'number' ||
      !Number.isSafeInteger(expires_in) || expires_in <= 0 ||
      data.token_type !== undefined && data.token_type !== 'Bearer' ||
      data.refresh_token !== undefined && !text(data.refresh_token) ||
      data.scope !== undefined && !text(data.scope)) throw invalid();
  return {access_token, expires_in, refresh_token:text(data.refresh_token), scope:text(data.scope)};
}

/** @param {unknown} value @param {'drive'|'calendar'} service @returns {string} */
export function decodeGoogleAccount(value, service) {
  const data = record(value);
  if (service === 'drive') {
    const user = record(data.user), id = text(user.permissionId) || text(user.emailAddress);
    if (!id) throw invalid();
    return id;
  }
  if (!Array.isArray(data.items)) throw invalid();
  const items = data.items.map(record);
  const primary = items.find(item => item.primary === true) || items.find(item => item.accessRole === 'owner') || items[0];
  const id = text(primary?.id);
  if (!id) throw invalid();
  return id;
}
