// @ts-nocheck
import { normalizeAccountPart, parseAccountSelector } from './hapoalim-account-selector.mjs';

function accountDescriptor(account) {
  const bankNumber = normalizeAccountPart(account?.bankNumber);
  const branchNumber = normalizeAccountPart(account?.branchNumber);
  const accountNumber = normalizeAccountPart(account?.accountNumber);
  const accountId = [bankNumber, branchNumber, accountNumber].filter(Boolean).join('-');
  return { ...account, bankNumber, branchNumber, accountNumber, accountId };
}

export function publicAccountDescriptors(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .map(accountDescriptor)
    .filter((x) => x.branchNumber && x.accountNumber)
    .map((x) => ({
      bankNumber: x.bankNumber || '12',
      branchNumber: x.branchNumber,
      accountNumber: x.accountNumber,
      accountId: x.accountId || ['12', x.branchNumber, x.accountNumber].join('-'),
    }));
}

function accountSelectionError(code, message, accounts) {
  const e = new Error(message);
  e.code = code;
  e.availableAccounts = publicAccountDescriptors(accounts);
  return e;
}

function descriptorMatchesSelector(descriptor, selector) {
  if (!selector.accountNumber) return false;
  if (descriptor.accountNumber !== selector.accountNumber) return false;
  if (selector.branchNumber && descriptor.branchNumber !== selector.branchNumber) return false;
  if (
    selector.bankNumber &&
    selector.branchNumber &&
    descriptor.bankNumber &&
    descriptor.bankNumber !== selector.bankNumber
  )
    return false;
  return true;
}

export function selectAccountDescriptor(accounts, targetAccount = '') {
  const normalized = (Array.isArray(accounts) ? accounts : [])
    .map(accountDescriptor)
    .filter((x) => x.branchNumber && x.accountNumber);
  if (!normalized.length) {
    const e = new Error('בנק הפועלים לא החזיר חשבונות עו״ש פעילים');
    e.code = 'NO_ACCOUNTS';
    throw e;
  }
  const selector = parseAccountSelector(targetAccount);
  if (selector.accountNumber) {
    const matches = normalized.filter((x) => descriptorMatchesSelector(x, selector));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1)
      throw accountSelectionError(
        'AMBIGUOUS_ACCOUNT',
        'מספר החשבון מתאים ליותר מחשבון אחד. יש לבחור גם את הסניף המדויק.',
        normalized
      );
    throw accountSelectionError(
      'ACCOUNT_NOT_FOUND',
      'החשבון שהוגדר לא נמצא בין החשבונות הפעילים שהחזיר בנק הפועלים.',
      normalized
    );
  }
  if (normalized.length === 1) return normalized[0];
  throw accountSelectionError(
    'MULTIPLE_ACCOUNTS',
    'נמצאו כמה חשבונות בבנק הפועלים. יש לבחור סניף ומספר חשבון מדויקים.',
    normalized
  );
}
