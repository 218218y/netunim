// @ts-check
import {
  explicitTransactionTime,
  hasOwn,
  isProviderList,
  isProviderRecord,
  providerRecord,
  safeDate,
  safeError,
  text,
} from './credit-value-codec.mjs';
import { CAL_FRAMES_NOT_RELEVANT_STATUS, CAL_TRANSACTION_TYPES } from './credit-adapter-wire.mjs';
import { normalizeCreditScrapeTransaction } from './credit-transaction-model.mjs';
import {creditNumber} from './credit-core-values.mjs';
import {creditObservationKey} from './credit-transaction-identity.mjs';

/** @param {unknown} value @param {number} delta */
function shiftMonthDate(value, delta) {
  const iso = safeDate(value);
  if (!iso) return null;
  const d = new Date(iso),
    first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)),
    last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), last))
  ).toISOString();
}

/** @param {unknown} value */
function calCurrency(value) {
  const v = text(value, 12);
  return ['ש"ח', 'ש״ח', 'NIS'].includes(v) ? 'ILS' : v;
}

const CAL_BILLING_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** @param {unknown} value */
function calBillingDate(value) {
  const raw = String(value || ''),
    day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const iso = safeDate(`${day}T00:00:00Z`);
  if (iso?.slice(0, 10) !== day) return null;
  if (raw.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const instant = safeDate(raw);
    return instant ? `${CAL_BILLING_DAY_FORMAT.format(new Date(instant))}T00:00:00.000Z` : null;
  }
  return iso;
}

/** @param {unknown} value */
function calIsIls(value) {
  return ['ILS', '₪'].includes(calCurrency(value));
}

const CAL_LOCAL_TIME_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** @param {unknown} value */
function calPurchaseDate(value) {
  const raw = String(value || ''),
    iso = safeDate(raw);
  if (!iso) return null;
  return raw.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
    ? `${CAL_LOCAL_TIME_FORMAT.format(new Date(iso)).replace(' ', 'T')}.000Z`
    : iso;
}

/** @param {unknown} input @param {'Transactions'|'Pending'} [stage] */
export function normalizeVisaCalTransaction(input, stage = 'Transactions') {
  const transaction = requireRecord(input, stage);
  const pending = transaction.debCrdDate === undefined || transaction.debCrdDate === null,
    numOfPayments = Number(pending ? transaction.numberOfPayments : transaction.numOfPayments),
    part = Number(pending ? 1 : transaction.curPaymentNum),
    installments =
      numOfPayments > 0
        ? { number: Math.max(1, Math.trunc(part) || 1), total: Math.trunc(numOfPayments) }
        : null,
    purchaseDate = calPurchaseDate(transaction.trnPurchaseDate);
  if (!purchaseDate) throw calSchemaError(stage);
  const date = installments ? shiftMonthDate(purchaseDate, installments.number - 1) : purchaseDate;
  const chargedBase = creditNumber(pending ? transaction.trnAmt : transaction.amtBeforeConvAndIndex),
    originalBase = creditNumber(transaction.trnAmt),
    credit = String(transaction.trnTypeCode) === CAL_TRANSACTION_TYPES.credit;
  return normalizeCreditScrapeTransaction({
    identifier: pending ? '' : transaction.trnIntId,
    type: [
      CAL_TRANSACTION_TYPES.regular,
      CAL_TRANSACTION_TYPES.standingOrder,
      CAL_TRANSACTION_TYPES.debit,
    ].includes(
      String(transaction.trnTypeCode)
    )
      ? 'normal'
      : 'installments',
    status: pending ? 'pending' : 'completed',
    date,
    processedDate: pending ? purchaseDate : calBillingDate(transaction.debCrdDate),
    transactionDate: purchaseDate,
    transactionTime: explicitTransactionTime(purchaseDate),
    originalAmount: originalBase === null ? null : originalBase * (credit ? 1 : -1),
    originalCurrency: calCurrency(transaction.trnCurrencySymbol),
    chargedAmount: chargedBase === null ? null : -chargedBase,
    chargedCurrency: pending ? '' : calCurrency(transaction.debCrdCurrencySymbol),
    ...(!pending ? { chargeAmountStatus: chargedBase === null ? 'missing' : 'reported' } : {}),
    description: text(transaction.merchantName, 220) || 'עסקת אשראי',
    memo: text(transaction.transTypeCommentDetails, 260),
    installments,
  });
}

/** @param {Record<string, unknown>|undefined} data @param {string} fallback */
function visaCalProviderMessage(data, fallback) {
  return (
    text(data?.statusTitle, 160) ||
    text(data?.statusDescription, 160) ||
    text(data?.title, 160) ||
    fallback
  );
}

/** @param {'Transactions'|'Pending'|'Frames'} stage */
function calSchemaError(stage) {
  return safeError('כאל החזירה מבנה נתונים שאינו תואם לחוזה המחבר.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage, retryable: false });
}

/** @param {unknown} input @param {'Transactions'|'Pending'} stage */
function requireRecord(input, stage) {
  if (!isProviderRecord(input)) throw calSchemaError(stage);
  return input;
}

/** @param {unknown} input @param {'Transactions'|'Pending'} stage */
function optionalList(input, stage) {
  if (input == null) return [];
  if (!isProviderList(input)) throw calSchemaError(stage);
  return input;
}

/** @param {unknown} input @param {{startDate?:Date|string|null}} [options] */
export function parseVisaCalMonthData(input, { startDate = null } = {}) {
  const data = providerRecord(input);
  if (data?.statusCode !== 1)
    throw safeError(
      visaCalProviderMessage(data, 'כאל לא אישרה את קריאת החודש.'),
      'CREDIT_PROVIDER_DATA_ERROR',
      { stage: 'Transactions' }
    );
  const accounts = providerRecord(data.result)?.bankAccounts;
  if (!isProviderList(accounts))
    throw safeError(
      'כאל החזירה מבנה חודשי שאינו תואם לחוזה המחבר.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Transactions' }
    );
  const rows = [];
  for (const [accountIndex, inputAccount] of accounts.entries()) {
    const account = requireRecord(inputAccount, 'Transactions');
    const immediateDebits = account.immidiateDebits == null ? undefined : requireRecord(account.immidiateDebits, 'Transactions');
    const regular = optionalList(account.debitDates, 'Transactions');
    const immediate = optionalList(immediateDebits?.debitDays, 'Transactions');
    if (!isProviderList(account.debitDates) && !isProviderList(immediateDebits?.debitDays))
      throw calSchemaError('Transactions');
    for (const inputDebitDay of [...regular, ...immediate]) {
      const debitDay = requireRecord(inputDebitDay, 'Transactions');
      if (!isProviderList(debitDay.transactions))
        throw safeError('כאל החזירה debit day ללא מערך עסקאות.', 'CREDIT_PROVIDER_SCHEMA_ERROR', {
          stage: 'Transactions',
        });
      const due = calBillingDate(debitDay.date);
      const rawRows = Array.from(debitDay.transactions, raw => requireRecord(raw, 'Transactions'));
      const dayRows = rawRows.map(raw =>
        normalizeVisaCalTransaction(due && raw.debCrdDate != null ? { ...raw, debCrdDate: due } : raw)
      );
      // CAL's own transactions screen uses debitDates[].totalDebits[].amount
      // for the cycle header, not the sum of individual amtBeforeConvAndIndex.
      // Keep the purchases intact and expose any difference as a named row.
      const totals = optionalList(debitDay.totalDebits, 'Transactions')
        .map(total => requireRecord(total, 'Transactions'))
        .filter(total => calIsIls(total.currencySymbol));
      const reported = totals.length === 1 ? creditNumber(totals[0]?.amount) : null;
      // A blank charge is never replaced with the transaction's face value.
      // When CAL's complete ILS cycle total equals all explicitly charged rows,
      // its blank rows are informational for this cycle (fees waived/rewards).
      // Otherwise preserve them as unknown rather than inventing a zero debit.
      const ilsRows = dayRows.filter((tx, i) =>
        calIsIls(
          rawRows[i]?.debCrdCurrencySymbol || rawRows[i]?.trnCurrencySymbol
        )
      );
      if (due && reported !== null && dayRows.every((tx) => tx.status === 'completed')) {
        const seen = new Set(),
          known = ilsRows.reduce((sum, tx) => {
            if (tx.chargeAmountStatus !== 'reported' || tx.chargedAmount === null) return sum;
            const key = tx.id ? creditObservationKey(tx) : '';
            if (key && seen.has(key)) return sum;
            if (key) seen.add(key);
            return sum - Math.round(tx.chargedAmount * 100);
          }, 0);
        if (known === Math.round(reported * 100))
          for (const tx of ilsRows)
            if (tx.chargeAmountStatus === 'missing') tx.chargeAmountStatus = 'not_billed';
      }
      const complete =
        due &&
        rawRows.every(
          (raw, i) =>
            dayRows[i]?.status === 'completed' &&
            creditNumber(raw.amtBeforeConvAndIndex) !== null &&
            !!text(raw.debCrdCurrencySymbol)
        );
      if (complete && reported !== null) {
        const seen = new Set(),
          knownCents = dayRows.reduce((sum, tx) => {
            if (!calIsIls(tx.chargedCurrency) || tx.chargedAmount === null) return sum;
            const key = tx.id ? creditObservationKey(tx) : '';
            if (key && seen.has(key)) return sum;
            if (key) seen.add(key);
            return sum - Math.round(tx.chargedAmount * 100);
          }, 0),
          difference = Math.round(reported * 100) - knownCents;
        if (difference)
          dayRows.push(
            normalizeCreditScrapeTransaction({
              id: `cal-statement:${accountIndex}:${regular.includes(inputDebitDay) ? 'cycle' : 'immediate'}:${due.slice(0, 10)}:ILS`,
              type: 'statement_adjustment',
              status: 'completed',
              date: due,
              processedDate: due,
              transactionDate: due,
              chargedAmount: -difference / 100,
              chargedCurrency: 'ILS',
              originalAmount: -difference / 100,
              originalCurrency: 'ILS',
              description: 'התאמה לסיכום החיוב של כאל',
              memo: `סיכום כאל: ${reported.toFixed(2)} ₪; סכום העסקאות: ${(knownCents / 100).toFixed(2)} ₪. ההפרש מבוסס על סיכום חברת האשראי.`,
            })
          );
      }
      for (const tx of dayRows) {
        const billingDate = tx.processedDate;
        if (!startDate || typeof billingDate !== 'string' || !billingDate || Date.parse(billingDate) >= new Date(startDate).getTime())
          rows.push(tx);
      }
    }
  }
  return rows;
}

/** @param {unknown} input */
export function firstVisaCalRawTransaction(input) {
  const accounts = providerRecord(providerRecord(input)?.result)?.bankAccounts;
  if (!isProviderList(accounts)) return null;
  for (const inputAccount of accounts) {
    const account = providerRecord(inputAccount);
    const regular = account?.debitDates;
    const immediate = providerRecord(account?.immidiateDebits)?.debitDays;
    for (const day of [...(isProviderList(regular) ? regular : []), ...(isProviderList(immediate) ? immediate : [])]) {
      const transactions = providerRecord(day)?.transactions;
      const row = isProviderList(transactions) ? transactions.find(isProviderRecord) : undefined;
      if (row) return row;
    }
  }
  return null;
}

/** @param {unknown} input */
export function parseVisaCalPending(input) {
  const data = providerRecord(input);
  if (data?.statusCode === 96) return [];
  if (data?.statusCode !== 1)
    throw safeError(
      visaCalProviderMessage(data, 'כאל לא אישרה את קריאת העסקאות הממתינות.'),
      'CREDIT_PROVIDER_DATA_ERROR',
      { stage: 'Pending' }
    );
  const cards = providerRecord(data.result)?.cardsList;
  if (!isProviderList(cards))
    throw safeError(
      'כאל החזירה מבנה עסקאות ממתינות שאינו תואם לחוזה המחבר.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Pending' }
    );
  return cards.flatMap(card => {
    const transactions = requireRecord(card, 'Pending').authDetalisList;
    if (!isProviderList(transactions)) throw calSchemaError('Pending');
    return Array.from(transactions, raw => normalizeVisaCalTransaction(raw, 'Pending'));
  });
}

/** @param {Record<string, unknown>|undefined} data */
function visaCalFrameProviderError(data) {
  if (!data) return false;
  const resultMissing = data.result === undefined || data.result === null,
    statusCodeError = hasOwn(data, 'statusCode') && Number(data.statusCode) !== 1,
    status = data.status,
    statusError =
      hasOwn(data, 'status') &&
      (status === false ||
        (typeof status === 'number' && ![0, 1, 200].includes(status)) ||
        (typeof status === 'string' &&
          !['', '0', '1', '200', 'ok', 'success', 'successful'].includes(
            status.trim().toLowerCase()
          ))),
    titledMissing =
      resultMissing &&
      (text(data.statusTitle, 1) || text(data.statusDescription, 1) || text(data.title, 1));
  return statusCodeError || statusError || !!titledMissing;
}

function frameUnavailable() {
  return safeError(
    'כאל לא סיפקה נתון מסגרת עבור הכרטיס; העסקאות יישמרו ונתון המסגרת האחרון, אם קיים, יישאר כ־Last Known Good.',
    'CREDIT_FRAMES_UNAVAILABLE',
    { stage: 'Frames' }
  );
}

/** @param {unknown} value @param {string} name */
function readFrameNumber(value, name) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw safeError(
      `כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
  return value;
}

/** @param {unknown} value @param {string} name */
function readFrameDate(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string')
    throw safeError(
      `כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
  return value;
}

/** @param {unknown} group @param {string} name */
function validateFrameGroup(group, name) {
  if (group === undefined || group === null) return null;
  if (!isProviderRecord(group))
    throw safeError(`כאל החזירה קבוצת ${name} שאינה אובייקט.`, 'CREDIT_PROVIDER_SCHEMA_ERROR', {
      stage: 'Frames',
    });
  const nextTotalDebitForAccount = readFrameNumber(group.nextTotalDebitForAccount, `${name}.nextTotalDebitForAccount`);
  const nextTotalDebitDateForAccount = readFrameDate(group.nextTotalDebitDateForAccount, `${name}.nextTotalDebitDateForAccount`);
  const frameLimitForCardAmount = readFrameNumber(group.frameLimitForCardAmount, `${name}.frameLimitForCardAmount`);
  const fictiveMaxAccAmt = readFrameNumber(group.fictiveMaxAccAmt, `${name}.fictiveMaxAccAmt`);
  const frames = group.cardLevelFrames;
  if (
    frames != null && !isProviderList(frames)
  )
    throw safeError(
      `כאל החזירה ${name}.cardLevelFrames שאינו מערך.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
  const cardLevelFrames = Array.from(frames ?? [], frame => {
    if (!isProviderRecord(frame) || typeof frame.cardUniqueId !== 'string')
      throw safeError(
        `כאל החזירה רשומת cardLevelFrames לא תקינה בקבוצת ${name}.`,
        'CREDIT_PROVIDER_SCHEMA_ERROR',
        { stage: 'Frames' }
      );
    return {
      cardUniqueId: frame.cardUniqueId,
      nextTotalDebit: readFrameNumber(frame.nextTotalDebit, `${name}.cardLevelFrames.nextTotalDebit`),
      nextDebitDate: readFrameDate(frame.nextDebitDate, `${name}.cardLevelFrames.nextDebitDate`),
    };
  });
  return { nextTotalDebitForAccount, nextTotalDebitDateForAccount, frameLimitForCardAmount, fictiveMaxAccAmt, cardLevelFrames };
}

/** @param {unknown} input @param {{cardUniqueId?:string}} [card] */
export function parseVisaCalFrame(input, card = {}) {
  const data = providerRecord(input);
  // Cal status 87 means there is no card relevant to the Frames display. The same card can still return valid monthly transactions,
  // so this is a non-applicable frame result rather than a failed credit-card synchronization.
  if (Number(data?.statusCode) === CAL_FRAMES_NOT_RELEVANT_STATUS)
    return {
      balance: null,
      balanceDate: null,
      cardType: '',
      cardFrame: null,
      frameStatus: 'missing',
      frameFetchStatus: 'unavailable',
      warning: null,
    };
  if (visaCalFrameProviderError(data))
    throw safeError(
      visaCalProviderMessage(data, 'כאל החזירה שגיאת provider מפורשת בקריאת Frames.'),
      'CREDIT_PROVIDER_DATA_ERROR',
      { stage: 'Frames' }
    );
  if (data?.result === undefined || data?.result === null)
    return {
      balance: null,
      balanceDate: null,
      cardType: '',
      cardFrame: null,
      frameStatus: 'missing',
      frameFetchStatus: 'unavailable',
      warning: frameUnavailable(),
    };
  if (!isProviderRecord(data.result))
    throw safeError(
      'כאל החזירה result מסוג שאינו תואם לחוזה Frames 6.9.0.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
  const bankGroup = validateFrameGroup(data.result.bankIssuedCards, 'bankIssuedCards'),
    calGroup = validateFrameGroup(data.result.calIssuedCards, 'calIssuedCards'),
    bankFrame = bankGroup?.cardLevelFrames?.find((item) => item.cardUniqueId === card.cardUniqueId),
    calFrame = calGroup?.cardLevelFrames?.find((item) => item.cardUniqueId === card.cardUniqueId);
  let frame = bankFrame || calFrame,
    group = bankFrame ? bankGroup : calFrame ? calGroup : null,
    cardType = bankFrame ? 'bankIssued' : calFrame ? 'companyIssued' : '';
  if (!group && bankGroup && !calGroup) {
    group = bankGroup;
    cardType = 'bankIssued';
  } else if (!group && calGroup && !bankGroup) {
    group = calGroup;
    cardType = 'companyIssued';
  }
  if (!group)
    return {
      balance: null,
      balanceDate: null,
      cardType: '',
      cardFrame: null,
      frameStatus: 'missing',
      frameFetchStatus: 'unavailable',
      warning: frameUnavailable(),
    };
  const limit = group.frameLimitForCardAmount,
    fictiveMax = group.fictiveMaxAccAmt,
    amount =
      frame?.nextTotalDebit ??
      group.nextTotalDebitForAccount ??
      (limit !== undefined && limit !== null && fictiveMax !== undefined && fictiveMax !== null
        ? limit - fictiveMax
        : undefined),
    date = frame?.nextDebitDate ?? group.nextTotalDebitDateForAccount,
    hasData =
      (amount !== undefined && amount !== null) ||
      (date !== undefined && date !== null) ||
      (limit !== undefined && limit !== null);
  if (!hasData)
    return {
      balance: null,
      balanceDate: null,
      cardType,
      cardFrame: null,
      frameStatus: 'missing',
      frameFetchStatus: 'unavailable',
      warning: frameUnavailable(),
    };
  return {
    balance: amount === undefined || amount === null ? null : -amount,
    balanceDate: calBillingDate(date),
    cardType,
    cardFrame: limit === undefined || limit === null ? null : limit,
    frameStatus: 'fresh',
    frameFetchStatus: 'success',
    warning: null,
  };
}
