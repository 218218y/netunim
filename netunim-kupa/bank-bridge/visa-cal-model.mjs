// @ts-nocheck
import {
  explicitTransactionTime,
  hasOwn,
  safeDate,
  safeError,
  text,
} from './credit-value-codec.mjs';
import { CAL_FRAMES_NOT_RELEVANT_STATUS, CAL_TRANSACTION_TYPES } from './credit-adapter-wire.mjs';
import { normalizeCreditScrapeTransaction } from './lib.mjs';

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

function calCurrency(value) {
  const v = text(value, 12);
  return ['ש"ח', 'ש״ח', 'NIS'].includes(v) ? 'ILS' : v;
}

function calNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CAL_BILLING_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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

function calPurchaseDate(value) {
  const raw = String(value || ''),
    iso = safeDate(raw);
  if (!iso) return null;
  return raw.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
    ? `${CAL_LOCAL_TIME_FORMAT.format(new Date(iso)).replace(' ', 'T')}.000Z`
    : iso;
}

export function normalizeVisaCalTransaction(transaction = {}) {
  const pending = transaction.debCrdDate === undefined || transaction.debCrdDate === null,
    numOfPayments = Number(pending ? transaction.numberOfPayments : transaction.numOfPayments),
    part = Number(pending ? 1 : transaction.curPaymentNum),
    installments =
      numOfPayments > 0
        ? { number: Math.max(1, Math.trunc(part) || 1), total: Math.trunc(numOfPayments) }
        : null,
    purchaseDate = calPurchaseDate(transaction.trnPurchaseDate),
    date = installments ? shiftMonthDate(purchaseDate, installments.number - 1) : purchaseDate;
  const chargedBase = calNumber(pending ? transaction.trnAmt : transaction.amtBeforeConvAndIndex),
    originalBase = calNumber(transaction.trnAmt),
    credit = String(transaction.trnTypeCode) === CAL_TRANSACTION_TYPES.credit;
  return normalizeCreditScrapeTransaction({
    identifier: pending ? '' : transaction.trnIntId,
    type: [CAL_TRANSACTION_TYPES.regular, CAL_TRANSACTION_TYPES.standingOrder].includes(
      String(transaction.trnTypeCode)
    )
      ? 'normal'
      : 'installments',
    status: pending ? 'pending' : 'completed',
    date,
    processedDate: pending ? purchaseDate : calBillingDate(transaction.debCrdDate),
    transactionDate: purchaseDate,
    transactionTime: explicitTransactionTime(purchaseDate),
    originalAmount: Number.isFinite(originalBase) ? originalBase * (credit ? 1 : -1) : null,
    originalCurrency: calCurrency(transaction.trnCurrencySymbol),
    chargedAmount: Number.isFinite(chargedBase) ? -chargedBase : null,
    chargedCurrency: pending ? '' : calCurrency(transaction.debCrdCurrencySymbol),
    ...(!pending ? { chargeAmountStatus: chargedBase === null ? 'missing' : 'reported' } : {}),
    description: text(transaction.merchantName, 220) || 'עסקת אשראי',
    memo: text(transaction.transTypeCommentDetails, 260),
    installments,
  });
}

function visaCalProviderMessage(data, fallback) {
  return (
    text(data?.statusTitle, 160) ||
    text(data?.statusDescription, 160) ||
    text(data?.title, 160) ||
    fallback
  );
}

export function parseVisaCalMonthData(data, { startDate = null } = {}) {
  if (data?.statusCode !== 1)
    throw safeError(
      visaCalProviderMessage(data, 'כאל לא אישרה את קריאת החודש.'),
      'CREDIT_PROVIDER_DATA_ERROR',
      { stage: 'Transactions' }
    );
  if (!data?.result || !Array.isArray(data.result.bankAccounts))
    throw safeError(
      'כאל החזירה מבנה חודשי שאינו תואם לחוזה המחבר.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Transactions' }
    );
  const rows = [];
  for (const [accountIndex, account] of data.result.bankAccounts.entries()) {
    const regular = Array.isArray(account?.debitDates) ? account.debitDates : [],
      immediate = Array.isArray(account?.immidiateDebits?.debitDays)
        ? account.immidiateDebits.debitDays
        : [];
    for (const debitDay of [...regular, ...immediate]) {
      if (!Array.isArray(debitDay?.transactions))
        throw safeError('כאל החזירה debit day ללא מערך עסקאות.', 'CREDIT_PROVIDER_SCHEMA_ERROR', {
          stage: 'Transactions',
        });
      const due = calBillingDate(debitDay.date),
        dayRows = debitDay.transactions.map((raw) =>
          normalizeVisaCalTransaction(
            due && raw.debCrdDate != null ? { ...raw, debCrdDate: due } : raw
          )
        );
      // CAL's own transactions screen uses debitDates[].totalDebits[].amount
      // for the cycle header, not the sum of individual amtBeforeConvAndIndex.
      // Keep the purchases intact and expose any difference as a named row.
      const totals = Array.isArray(debitDay.totalDebits)
          ? debitDay.totalDebits.filter((total) => calIsIls(total?.currencySymbol))
          : [],
        reported = totals.length === 1 ? calNumber(totals[0].amount) : null;
      // A blank charge is never replaced with the transaction's face value.
      // When CAL's complete ILS cycle total equals all explicitly charged rows,
      // its blank rows are informational for this cycle (fees waived/rewards).
      // Otherwise preserve them as unknown rather than inventing a zero debit.
      const ilsRows = dayRows.filter((tx, i) =>
        calIsIls(
          debitDay.transactions[i].debCrdCurrencySymbol ||
            debitDay.transactions[i].trnCurrencySymbol
        )
      );
      if (due && reported !== null && dayRows.every((tx) => tx.status === 'completed')) {
        const seen = new Set(),
          known = ilsRows.reduce((sum, tx) => {
            if (tx.chargeAmountStatus !== 'reported') return sum;
            const key = tx.id ? `${tx.id}|${tx.installments?.number || 1}` : '';
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
        debitDay.transactions.every(
          (raw, i) =>
            dayRows[i].status === 'completed' &&
            calNumber(raw.amtBeforeConvAndIndex) !== null &&
            !!text(raw.debCrdCurrencySymbol)
        );
      if (complete && reported !== null) {
        const seen = new Set(),
          knownCents = dayRows.reduce((sum, tx) => {
            if (!calIsIls(tx.chargedCurrency)) return sum;
            const key = tx.id ? `${tx.id}|${tx.processedDate}|${tx.installments?.number || 1}` : '';
            if (key && seen.has(key)) return sum;
            if (key) seen.add(key);
            return sum - Math.round(tx.chargedAmount * 100);
          }, 0),
          difference = Math.round(reported * 100) - knownCents;
        if (difference)
          dayRows.push(
            normalizeCreditScrapeTransaction({
              id: `cal-statement:${accountIndex}:${regular.includes(debitDay) ? 'cycle' : 'immediate'}:${due.slice(0, 10)}:ILS`,
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
        if (!startDate || !billingDate || Date.parse(billingDate) >= Date.parse(startDate))
          rows.push(tx);
      }
    }
  }
  return rows;
}

export function firstVisaCalRawTransaction(data) {
  for (const account of Array.isArray(data?.result?.bankAccounts) ? data.result.bankAccounts : []) {
    for (const debitDay of [
      ...(Array.isArray(account?.debitDates) ? account.debitDates : []),
      ...(Array.isArray(account?.immidiateDebits?.debitDays)
        ? account.immidiateDebits.debitDays
        : []),
    ]) {
      const row = Array.isArray(debitDay?.transactions)
        ? debitDay.transactions.find((item) => item && typeof item === 'object')
        : null;
      if (row) return row;
    }
  }
  return null;
}

export function parseVisaCalPending(data) {
  if (data?.statusCode === 96) return [];
  if (data?.statusCode !== 1)
    throw safeError(
      visaCalProviderMessage(data, 'כאל לא אישרה את קריאת העסקאות הממתינות.'),
      'CREDIT_PROVIDER_DATA_ERROR',
      { stage: 'Pending' }
    );
  if (!Array.isArray(data?.result?.cardsList))
    throw safeError(
      'כאל החזירה מבנה עסקאות ממתינות שאינו תואם לחוזה המחבר.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Pending' }
    );
  return data.result.cardsList
    .flatMap((card) => (Array.isArray(card?.authDetalisList) ? card.authDetalisList : []))
    .map(normalizeVisaCalTransaction);
}

function visaCalFrameProviderError(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
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

function validateFrameNumber(value, name) {
  if (value !== undefined && value !== null && typeof value !== 'number')
    throw safeError(
      `כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
}

function validateFrameDate(value, name) {
  if (value !== undefined && value !== null && typeof value !== 'string')
    throw safeError(
      `כאל החזירה ${name} מסוג שאינו תואם לחוזה Frames 6.9.0.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
}

function validateFrameGroup(group, name) {
  if (group === undefined || group === null) return null;
  if (typeof group !== 'object' || Array.isArray(group))
    throw safeError(`כאל החזירה קבוצת ${name} שאינה אובייקט.`, 'CREDIT_PROVIDER_SCHEMA_ERROR', {
      stage: 'Frames',
    });
  validateFrameNumber(group.nextTotalDebitForAccount, `${name}.nextTotalDebitForAccount`);
  validateFrameDate(group.nextTotalDebitDateForAccount, `${name}.nextTotalDebitDateForAccount`);
  validateFrameNumber(group.frameLimitForCardAmount, `${name}.frameLimitForCardAmount`);
  validateFrameNumber(group.fictiveMaxAccAmt, `${name}.fictiveMaxAccAmt`);
  if (
    group.cardLevelFrames !== undefined &&
    group.cardLevelFrames !== null &&
    !Array.isArray(group.cardLevelFrames)
  )
    throw safeError(
      `כאל החזירה ${name}.cardLevelFrames שאינו מערך.`,
      'CREDIT_PROVIDER_SCHEMA_ERROR',
      { stage: 'Frames' }
    );
  for (const frame of Array.isArray(group.cardLevelFrames) ? group.cardLevelFrames : []) {
    if (
      !frame ||
      typeof frame !== 'object' ||
      Array.isArray(frame) ||
      typeof frame.cardUniqueId !== 'string'
    )
      throw safeError(
        `כאל החזירה רשומת cardLevelFrames לא תקינה בקבוצת ${name}.`,
        'CREDIT_PROVIDER_SCHEMA_ERROR',
        { stage: 'Frames' }
      );
    validateFrameNumber(frame.nextTotalDebit, `${name}.cardLevelFrames.nextTotalDebit`);
    validateFrameDate(frame.nextDebitDate, `${name}.cardLevelFrames.nextDebitDate`);
  }
  return group;
}

export function parseVisaCalFrame(data, card = {}) {
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
  if (typeof data.result !== 'object' || Array.isArray(data.result))
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
