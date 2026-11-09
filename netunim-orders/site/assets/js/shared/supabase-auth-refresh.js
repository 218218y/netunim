// Auth refresh is a rotating-token operation. Preserve the login on temporary
// failures and let the caller's normal retry/reconnect flow retry it later.
export function temporaryAuthRefreshError(response, body) {
  const status = response.status;
  const reason = body?.error_code ?? body?.code;
  const timedOut = status === 408 || reason === 'request_timeout';
  if (!timedOut && status !== 429 && status < 500 &&
      !['over_request_rate_limit', 'unexpected_failure', 'conflict'].includes(reason)) return null;
  const code = timedOut ? 'SUPABASE_NETWORK_TIMEOUT' : 'SUPABASE_AUTH_REFRESH_UNAVAILABLE';
  return Object.assign(new Error('חידוש ההתחברות לענן אינו זמין כרגע. אפשר לנסות שוב.'), {
    code, status, response: {status, headers: response.headers},
  });
}

export function assertRefreshTokenCurrent(previous, current) {
  if (previous !== current) {
    throw Object.assign(new Error('ההתחברות לענן השתנתה במהלך חידוש ההתחברות.'), {
      code: 'cloud_auth_scope_changed',
    });
  }
}

export function assertRefreshReceipt(session, owner) {
  if (session?.user?.id !== owner || typeof session.access_token !== 'string' || !session.access_token.trim() ||
      typeof session.refresh_token !== 'string' || !session.refresh_token.trim()) {
    throw Object.assign(new Error('חידוש ההתחברות לענן החזיר תשובה לא תקינה. אפשר לנסות שוב.'), {
      code: 'SUPABASE_AUTH_REFRESH_UNAVAILABLE',
    });
  }
}
