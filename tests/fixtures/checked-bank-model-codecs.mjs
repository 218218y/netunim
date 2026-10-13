// @ts-check
import {
  parseAccountSelector,
  normalizeAccountPart,
} from '../../netunim-kupa/bank-bridge/hapoalim-account-selector.mjs';
import { ymdDate, isoFromBankDate } from '../../netunim-kupa/bank-bridge/hapoalim-date-codec.mjs';
import { meaningfulDetailValue } from '../../netunim-kupa/bank-bridge/hapoalim-detail-values.mjs';
import {
  isUnsafeTechnicalDetailKey,
  isDocumentDetailKey,
} from '../../netunim-kupa/bank-bridge/hapoalim-detail-keys.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/hapoalim-account-selector.mjs').BankAccountSelector} */
const account = parseAccountSelector({
  bankNumber: 12,
  branchNumber: '003',
  accountNumber: '00042',
});
account.accountNumber.toUpperCase();
normalizeAccountPart(42).toUpperCase();
const instant = isoFromBankDate(20261013);
if (instant !== null) instant.toUpperCase();
ymdDate(new Date()).toUpperCase();
meaningfulDetailValue({}).toUpperCase();
const unsafe = isUnsafeTechnicalDetailKey('Authorization');
/** @type {string} */
// @ts-expect-error detail-key classifications cannot become display labels
const label = unsafe;
void label;
// @ts-expect-error account identities remain normalized strings rather than numeric IDs
account.accountNumber = 42;
// @ts-expect-error a nullable bank date must be checked before using string methods
instant.toUpperCase();
// @ts-expect-error document markers return a boolean, not an asynchronous read
isDocumentDetailKey('image').then(() => {});
// @ts-expect-error the formatter expects a date/string/number, not an account record
ymdDate(account);
