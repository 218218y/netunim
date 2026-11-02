// @ts-check
import {readJsonBodyBounded} from '../../netunim-orders/supabase/functions/_shared/http-input.js';
import {createGoogleHttp} from '../../netunim-orders/supabase/functions/_shared/google-http.js';
import {decodeGoogleToken, decodeGoogleAccount} from '../../netunim-orders/supabase/functions/_shared/google-receipts.js';

/** @param {Request} request */
async function consume(request) {
  const body = await readJsonBodyBounded(request, 16384);
  // @ts-expect-error incoming JSON stays unknown until a field decoder runs
  body.action.toUpperCase();
  const raw = await createGoogleHttp()('https://oauth2.googleapis.com/token', {});
  // @ts-expect-error successful HTTP JSON alone grants no access-token authority
  raw.access_token.toUpperCase();
  const token = decodeGoogleToken(raw);
  token.access_token.toUpperCase();
  token.expires_in.toFixed();
  // @ts-expect-error expiry is a validated number
  token.expires_in.toUpperCase();
  decodeGoogleAccount(raw, 'drive').toUpperCase();
  // @ts-expect-error services have an explicit closed contract
  decodeGoogleAccount(raw, 'mail');
}
void consume;
