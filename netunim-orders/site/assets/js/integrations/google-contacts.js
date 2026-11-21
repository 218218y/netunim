export async function requestGoogleContacts(supaFetch, action, fields, signal) {
  signal.throwIfAborted();
  const response = await supaFetch('/functions/v1/google-contacts-oauth', {
    method: 'POST', body: JSON.stringify({action, ...fields}), signal,
    networkRetry: false, networkTimeoutMs: 20_000,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') {
    throw Object.assign(new Error('Google Contacts request failed'), {code: data?.code || 'contacts_unavailable'});
  }
  signal.throwIfAborted();
  return data;
}
