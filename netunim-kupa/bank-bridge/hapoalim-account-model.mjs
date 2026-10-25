// @ts-check
import { normalizeAccountPart, parseAccountSelector } from './hapoalim-account-selector.mjs';

/** @typedef {Record<string,unknown> & {bankNumber:string,branchNumber:string,accountNumber:string,accountId:string}} AccountDescriptor */
/** @param {unknown} account @returns {AccountDescriptor} */
function accountDescriptor(account) {
  // Object boxing matches property access/spread for the retained raw provider row.
  /** @type {Record<string,unknown>} */ const source=Object(account);
  const bankNumber = normalizeAccountPart(source.bankNumber);
  const branchNumber = normalizeAccountPart(source.branchNumber);
  const accountNumber = normalizeAccountPart(source.accountNumber);
  const accountId = [bankNumber, branchNumber, accountNumber].filter(Boolean).join('-');
  return { ...source, bankNumber, branchNumber, accountNumber, accountId };
}

/** @param {unknown} accounts */
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

/** @param {string} code @param {string} message @param {unknown} accounts */
function accountSelectionError(code, message, accounts) {
  const e = Object.assign(new Error(message),{code,availableAccounts:publicAccountDescriptors(accounts)});
  return e;
}

/** @param {AccountDescriptor} descriptor @param {import('./hapoalim-account-selector.mjs').BankAccountSelector} selector */
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

/** @param {unknown} accounts @param {unknown} [targetAccount] @returns {AccountDescriptor} */
export function selectAccountDescriptor(accounts, targetAccount = '') {
  const normalized = (Array.isArray(accounts) ? accounts : [])
    .map(accountDescriptor)
    .filter((x) => x.branchNumber && x.accountNumber);
  if (!normalized.length) {
    const e = new Error('בנק הפועלים לא החזיר חשבונות עו״ש פעילים');
    throw Object.assign(e,{code:'NO_ACCOUNTS'});
  }
  const selector = parseAccountSelector(targetAccount);
  if (selector.accountNumber) {
    const matches = normalized.filter((x) => descriptorMatchesSelector(x, selector));
    if (matches.length === 1) return /** @type {AccountDescriptor} */ (matches[0]);
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
  if (normalized.length === 1) return /** @type {AccountDescriptor} */ (normalized[0]);
  throw accountSelectionError(
    'MULTIPLE_ACCOUNTS',
    'נמצאו כמה חשבונות בבנק הפועלים. יש לבחור סניף ומספר חשבון מדויקים.',
    normalized
  );
}
