// @ts-nocheck
import { creditText } from './credit-core-values.mjs';

export const CREDIT_PROVIDER_CONFIG = {
  visaCal: { label: 'כאל', credentialFields: ['username', 'password'] },
  max: { label: 'MAX', credentialFields: ['username', 'password'] },
  isracard: { label: 'ישראכרט', credentialFields: ['id', 'card6Digits', 'password'] },
  amex: { label: 'American Express', credentialFields: ['id', 'card6Digits', 'password'] },
};

export function creditProviderSupported(value) {
  return Object.prototype.hasOwnProperty.call(CREDIT_PROVIDER_CONFIG, String(value || ''));
}

export function creditProfilePublic(profile) {
  return {
    profileId: creditText(profile?.profileId, 80),
    provider: creditText(profile?.provider, 30),
    label: creditText(profile?.label, 100),
    ownerLabel: creditText(profile?.ownerLabel, 100),
    defaultAccount: profile?.defaultAccount === 'ביתי' ? 'ביתי' : 'עסקי',
    active: profile?.active !== false,
    configured: true,
  };
}

export function creditProfilesShareLoginIdentity(a, b) {
  const provider = creditText(a?.provider, 30);
  if (!provider || provider !== creditText(b?.provider, 30) || !creditProviderSupported(provider))
    return false;
  if (provider === 'visaCal' || provider === 'max') {
    const av = String(a?.credentials?.username || '').trim(),
      bv = String(b?.credentials?.username || '').trim();
    return !!av && av === bv;
  }
  const av = String(a?.credentials?.id || '').replace(/\D/g, ''),
    bv = String(b?.credentials?.id || '').replace(/\D/g, '');
  return !!av && av === bv;
}

export function normalizeCreditProfileInput(value = {}, existing = null) {
  const provider = creditText(value.provider || existing?.provider, 30);
  if (!creditProviderSupported(provider)) {
    const e = new Error('חברת האשראי שנבחרה אינה נתמכת');
    e.code = 'UNSUPPORTED_CREDIT_PROVIDER';
    throw e;
  }
  const profileId = creditText(value.profileId || existing?.profileId, 80);
  const label =
    creditText(value.label || existing?.label || CREDIT_PROVIDER_CONFIG[provider].label, 100) ||
    CREDIT_PROVIDER_CONFIG[provider].label;
  const ownerLabel = creditText(value.ownerLabel || existing?.ownerLabel || '', 100);
  const defaultAccount =
    value.defaultAccount === 'ביתי'
      ? 'ביתי'
      : value.defaultAccount === 'עסקי'
        ? 'עסקי'
        : existing?.defaultAccount === 'ביתי'
          ? 'ביתי'
          : 'עסקי';
  const credentials = { ...(existing?.credentials || {}) };
  for (const field of CREDIT_PROVIDER_CONFIG[provider].credentialFields) {
    const incoming = String(value[field] ?? '');
    if (incoming) credentials[field] = incoming;
  }
  for (const field of CREDIT_PROVIDER_CONFIG[provider].credentialFields) {
    if (!String(credentials[field] || '').trim()) {
      const e = new Error(`חסר שדה התחברות נדרש: ${field}`);
      e.code = 'MISSING_CREDIT_CREDENTIALS';
      throw e;
    }
  }
  if (provider === 'isracard' || provider === 'amex') {
    credentials.id = String(credentials.id || '').replace(/\D/g, '');
    credentials.card6Digits = String(credentials.card6Digits || '').replace(/\D/g, '');
    if (credentials.card6Digits.length !== 6) {
      const e = new Error('בישראכרט/American Express יש להזין 6 ספרות אחרונות של הכרטיס');
      e.code = 'INVALID_CARD6';
      throw e;
    }
  }
  return {
    profileId,
    provider,
    label,
    ownerLabel,
    defaultAccount,
    active: value.active === undefined ? existing?.active !== false : !!value.active,
    credentials,
  };
}
