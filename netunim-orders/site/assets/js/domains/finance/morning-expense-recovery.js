const uuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
function keys(owner, environment) {
  if (!uuid(owner) || !['sandbox', 'production'].includes(environment)) throw new Error('נדרשת התחברות וסביבת Morning תקינה.');
  return {current:`morningExpenseOperation:${environment}:${owner}`, legacy:`morningExpenseOperation:${owner}`};
}
function decode(raw, environment) {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && value.environment === environment && uuid(value.operationId) ?
      {version:1, operationId:value.operationId, environment} : null;
  } catch {return null;}
}
export function readExpenseRecovery(storage, owner, environment) {
  const key = keys(owner, environment);
  return decode(storage.getItem(key.current), environment) || decode(storage.getItem(key.legacy), environment);
}
export function writeExpenseRecovery(storage, owner, environment, operationId) {
  const key = keys(owner, environment);
  if (!uuid(operationId)) throw new Error('מזהה הפעולה אינו תקין.');
  // Do not swallow storage errors: a new financial POST requires durable intent.
  storage.setItem(key.current, JSON.stringify({version:1, operationId, environment}));
}
export function clearExpenseRecovery(storage, owner, environment) {
  const key = keys(owner, environment);
  storage.removeItem(key.current);
  if (decode(storage.getItem(key.legacy), environment)) storage.removeItem(key.legacy);
}
