// @ts-check
import { hasOwn, isProviderList, isProviderRecord, providerRecord, safeDate, safeSuffix, safeError, text } from './credit-value-codec.mjs';
import { creditDebitAmount,assertCreditNumericInput } from './credit-core-values.mjs';
import { normalizeCreditScrapeTransaction } from './credit-transaction-model.mjs';
import { creditObservationKey, creditPendingSourceKey } from './credit-transaction-identity.mjs';

/** @typedef {Record<string, unknown>} ProviderRecord */
/** @typedef {{raw:ProviderRecord,path:string}} MaxCandidate */
/** @typedef {{path:string,count:number,sampleKeys:string[]}} MaxArrayEvidence */
/** @typedef {{accountSuffix:string,candidateCount:number,foreignSignalCount:number,offCycleCount:number}} MaxAccountEvidence */
/** @typedef {{resultPresent?:boolean,verifiedEmptyCode?:10|11,resultKeys?:string[],arrayPaths?:MaxArrayEvidence[],
 * legacyTransactionsCount?:number,candidateCount?:number,candidatePaths?:string[],candidateAccountSummary?:MaxAccountEvidence[],
 * foreignSignalCandidateCount?:number,offCycleCandidateCount?:number,candidateAuditSamples?:ReturnType<typeof maxCandidateAudit>[],
 * candidateAuditTruncated?:boolean}} MaxResponseShape */

/** @param {unknown} value */
function maxNumber(value) {
  assertCreditNumericInput(value);
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value)
    .trim()
    .replace(/[₪$€\s]/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '');
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} value */
function maxProviderDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim(),
    dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw),
    iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw),
    match = dmy || iso;
  if (!match) return null;
  const year = Number(dmy ? match[3] : match[1]), month = Number(match[2]), day = Number(dmy ? match[1] : match[3]),
    hour = Number(match[4] || 0), minute = Number(match[5] || 0), second = Number(match[6] || 0),
    leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = days[month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return safeDate(dmy ? `${match[3]}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}Z` : raw.replace(' ', 'T'));
}

/** @param {unknown} value */
function maxChargedCurrency(value) {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (['376', 'ILS', 'NIS', '₪', 'ש"ח', 'ש״ח', 'שח'].includes(raw)) return 'ILS';
  if (['840', 'USD', '$'].includes(raw)) return 'USD';
  if (['978', 'EUR', '€'].includes(raw)) return 'EUR';
  return raw && raw.length <= 12 ? raw : '';
}

/** @param {ProviderRecord} [raw] */
function maxInstallments(raw = {}) {
  const comments = String(raw.comments || ''),
    numbers = comments.match(/\d+/g) || [],
    planType = Math.trunc(Number(raw.planTypeId) || 0),
    planName = String(raw.planName || '');
  if (numbers.length >= 2) {
    const number = Number(numbers[0]),
      total = Number(numbers[1]);
    if (number > 0 && total > 0) return { number, total };
  }
  if ([2, 3].includes(planType) || /תשלומ/.test(planName)) return null;
  return null;
}

/** @param {ProviderRecord} [raw] */
function maxMemo(raw = {}) {
  const comments = text(raw.comments, 180),
    receiver = text(raw.fundsTransferReceiverOrTransfer, 120),
    detail = text(raw.fundsTransferComment, 120),
    base = [comments, receiver].filter(Boolean).join(' '),
    memo = detail ? [base, detail].filter(Boolean).join(': ') : base,
    promotion = [text(raw.promotionClub, 180), text(raw.promotionAmount, 60)]
      .filter(Boolean)
      .join(': ');
  return promotion ? [memo, promotion].filter(Boolean).join(' | ') : memo;
}

/** @param {ProviderRecord} [raw] @param {ReturnType<typeof maxInstallments>} [installments] */
function maxRawIdentifier(raw = {}, installments = null) {
  const deal = providerRecord(raw.dealData);
  const candidates = [
      deal?.arn,
      deal?.transactionId,
      raw?.transactionId,
      raw?.dealId,
      raw?.referenceNumber,
    ]
      .map((value) => text(value, 100))
      .filter(Boolean),
    base = candidates[0] || '';
  return base && installments?.number ? `${base}_${installments.number}` : base;
}

/** @param {unknown} raw @returns {raw is ProviderRecord} */
function maxRawLooksLikeTransaction(raw) {
  if (!isProviderRecord(raw)) return false;
  const card = text(raw.shortCardNumber, 80),
    purchase = text(raw.purchaseDate, 80),
    merchant = text(raw.merchantName || raw.businessName, 220),
    hasAmount = hasOwn(raw, 'actualPaymentAmount') || hasOwn(raw, 'originalAmount');
  return (
    !!card &&
    !!purchase &&
    hasAmount &&
    (!!merchant || hasOwn(raw, 'planName') || hasOwn(raw, 'planTypeId'))
  );
}

/** @type {Readonly<Record<string,readonly string[]>>} */
const MAX_METADATA_ARRAY_FIELDS = Object.freeze({
  'result.totalCycle': ['currency', 'futureDebit', 'pastDebit', 'totalAmount'],
  'result.categories': ['currency', 'id', 'ilsSum', 'sum'],
  'result.barsGraphDetailsResult.monthlySummary': ['actualDebitSumNIS', 'date', 'isFutureDebit'],
  'result.cancelDenialData.cancelDenialReasons': ['reasonId', 'reasonText'],
});

/** @param {string} path @param {unknown[]} rows */
function maxMetadataArray(path, rows) {
  // These non-transaction array shapes were verified in actual MAX diagnostic
  // structure evidence. New nonempty shapes need review, never a guessed empty.
  const fields = MAX_METADATA_ARRAY_FIELDS[path];
  return !!fields && rows.every(row => isProviderRecord(row) &&
    Object.keys(row).every(key => fields.includes(key)) &&
    Object.values(row).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
}

/** @param {unknown} value @param {string} [path] @param {MaxCandidate[]} [out]
 * @param {MaxArrayEvidence[]} [arrayEvidence] @param {number} [depth] @param {string[]} [transactionLists] */
function maxWalkTransactionCandidates(
  value,
  path = 'result',
  out = [],
  arrayEvidence = [],
  depth = 0,
  transactionLists = []
) {
  if (value === null || value === undefined) return { out, arrayEvidence, transactionLists };
  if (depth > 10) {
    if (typeof value === 'object' && Object.keys(value).length)
      throw safeError('מבנה פירוט MAX חורג מעומק הפענוח הנתמך. הריענון נעצר.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'depth_exceeded' });
    return { out, arrayEvidence, transactionLists };
  }
  if (isProviderList(value)) {
    const knownList = path.endsWith('.transactions') || path === 'result.foreignAndCurrency.chargedNow',
      recognizedRows = value.length > 0 && value.every(maxRawLooksLikeTransaction);
    if (value.length && !recognizedRows && (knownList || !maxMetadataArray(path, value)))
      throw safeError('MAX החזירה רשימה שאינה ריקה אך לא ניתן לפענח את כל רשומותיה. הנתונים הקודמים נשמרו.',
        'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'unexpected_nonempty_array' });
    if (knownList || recognizedRows) transactionLists.push(path);
    const firstObject = value.find(isProviderRecord);
    arrayEvidence.push({
      path: text(path, 180),
      count: value.length,
      sampleKeys: firstObject ? Object.keys(firstObject).sort().slice(0, 50) : [],
    });
    value.forEach((item, index) =>
      maxWalkTransactionCandidates(item, `${path}[${index}]`, out, arrayEvidence, depth + 1, transactionLists)
    );
    return { out, arrayEvidence, transactionLists };
  }
  if (typeof value !== 'object') return { out, arrayEvidence, transactionLists };
  if (maxRawLooksLikeTransaction(value))
    out.push({ raw: value, path: text(path.replace(/\[\d+\]/g, '[]'), 180) });
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'transactions' || path === 'result.foreignAndCurrency' && key === 'chargedNow') && !Array.isArray(child))
      throw safeError('רשימת התנועות בפירוט MAX אינה מערך תקין. הנתונים הקודמים נשמרו.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'transaction_list_wrong_type' });
    maxWalkTransactionCandidates(child, `${path}.${key}`, out, arrayEvidence, depth + 1, transactionLists);
  }
  return { out, arrayEvidence, transactionLists };
}

/** @param {ProviderRecord} raw @param {import('./credit-model-contracts.js').CreditScrapeTransaction} tx */
function maxCandidateKey(raw, tx) {
  return JSON.stringify([text(raw.shortCardNumber, 80), creditObservationKey(tx)]);
}

/** @param {ProviderRecord} raw */
function maxForeignSignalLabels(raw) {
  const deal = providerRecord(raw.dealData);
  const labels = [],
    currencies = [
      ['originalCurrency', maxChargedCurrency(raw.originalCurrency)],
      ['paymentCurrency', maxChargedCurrency(raw.paymentCurrency)],
      ['issuerCurrency', maxChargedCurrency(deal?.issuerCurrency)],
    ];
  for (const [field, currency] of currencies)
    if (currency && currency !== 'ILS') labels.push(`${field}:${currency}`);
  const exchangeRate = maxNumber(deal?.exchangeRate),
    issuerExchangeRate = maxNumber(deal?.issuerExchangeRate);
  if (exchangeRate !== null && exchangeRate !== 0) labels.push('exchangeRate');
  if (issuerExchangeRate !== null && issuerExchangeRate !== 0) labels.push('issuerExchangeRate');
  const wording = [raw.planName, raw.comments, raw.fundsTransferComment]
    .map((value) => String(value || ''))
    .join(' ');
  if (/חו["״']?ל|מט["״']?ח|foreign|currency|overseas/i.test(wording)) labels.push('providerText');
  return [...new Set(labels)].slice(0, 12);
}

/** @param {ProviderRecord} raw */
function maxOffCyclePayment(raw) {
  const date = maxProviderDate(raw.paymentDate);
  if (!date) return false;
  const day = new Date(date).getUTCDate();
  return day < 7 || day > 18;
}

/** @param {MaxCandidate} item */
function maxCandidateAudit(item) {
  const raw = item.raw,
    deal = providerRecord(raw.dealData),
    foreignSignals = maxForeignSignalLabels(raw),
    offCyclePayment = maxOffCyclePayment(raw);
  return {
    sourcePath: text(item.path, 180),
    accountSuffix: safeSuffix(raw.shortCardNumber),
    purchaseDate: maxProviderDate(raw.purchaseDate),
    paymentDate: maxProviderDate(raw.paymentDate),
    merchantName: text(raw.merchantName || raw.businessName, 180),
    planName: text(raw.planName, 120),
    planTypeId: Number.isFinite(Number(raw.planTypeId)) ? Math.trunc(Number(raw.planTypeId)) : null,
    categoryId: Number.isFinite(Number(raw.categoryId)) ? Math.trunc(Number(raw.categoryId)) : null,
    originalAmount: maxNumber(raw.originalAmount),
    originalCurrency: maxChargedCurrency(raw.originalCurrency) || text(raw.originalCurrency, 12),
    actualPaymentAmount: maxNumber(raw.actualPaymentAmount),
    paymentCurrency: maxChargedCurrency(raw.paymentCurrency),
    issuerCurrency: maxChargedCurrency(deal?.issuerCurrency),
    exchangeRate: maxNumber(deal?.exchangeRate),
    issuerExchangeRate: maxNumber(deal?.issuerExchangeRate),
    foreignSignals,
    offCyclePayment,
  };
}

/** @param {ProviderRecord|undefined} data */
function maxProviderReply(data) {
  if(!data||!Object.hasOwn(data,'returnCode'))return null;
  const code=data.returnCode;
  if(code===0)return null;
  if(code===9||code===13)throw safeError(code===9?'MAX אינה יכולה להציג את פירוט התקופה כרגע. המידע הקודם נשמר.':'MAX דיווחה על ריבוי תנועות שאינו ניתן להצגה בבקשה זו. אין אישור לחודש ריק.',
    code===9?'CREDIT_PROVIDER_PERIOD_UNAVAILABLE':'CREDIT_PROVIDER_ROW_LIMIT_EXCEEDED',
    {stage:'MaxTransactions',diagnosticReason:code===9?'provider_unavailable':'provider_row_limit',providerReturnCode:String(code)});
  if(code===10||code===11){
    const fields=['returnCode','rcDesc','result','correlationID'];
    if(Object.keys(data).length===fields.length&&fields.every(key=>Object.hasOwn(data,key))&&data.result===null&&
      (data.rcDesc===null||typeof data.rcDesc==='string'&&data.rcDesc.length<=1000)&&
      (data.correlationID===null||typeof data.correlationID==='string'&&data.correlationID.length<=128))return code;
    throw safeError('MAX החזירה קוד היעדר תנועות במעטפת שאינה תואמת לחוזה המאומת. הנתונים הקודמים נשמרו.',
      'CREDIT_PROVIDER_SCHEMA_ERROR',{stage:'MaxTransactions',diagnosticReason:'contradictory_empty_response'});
  }
  throw safeError('MAX החזירה קוד דחייה לא מוכר. הסנכרון נעצר ושומר את הנתונים הקודמים.',
    'CREDIT_PROVIDER_DATA_ERROR',{stage:'MaxTransactions',diagnosticReason:'provider_rejected'});
}

/** @param {unknown} [input] @returns {{transactions:ProviderRecord[],evidence:MaxResponseShape}} */
export function extractMaxTransactionCandidates(input) {
  const data=providerRecord(input);
  const verifiedEmptyCode=maxProviderReply(data);
  if(verifiedEmptyCode)return {transactions:[],evidence:{resultPresent:false,verifiedEmptyCode}};
  const result = data?.result;
  if (!isProviderRecord(result))
    throw safeError('MAX לא החזירה מעטפת פירוט מזוהה. הריענון נעצר ללא החלפת הנתונים הקודמים.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions' });
  const { out, arrayEvidence, transactionLists } = maxWalkTransactionCandidates(result);
  if (!transactionLists.length)
    throw safeError('לא נמצאה רשימת תנועות מזוהה בתשובת MAX. אין ראיה לחודש ריק.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'transaction_list_missing' });
  const seen = new Set(),
    sources = /** @type {Map<string, Set<string>>} */ (new Map()),
    cards = /** @type {Map<string, string>} */ (new Map()),
    anonymousPaths = /** @type {Map<string, string>} */ (new Map()),
    transactions = [],
    uniqueItems = [],
    candidatePaths = new Set();
  for (const item of out) {
    const tx = normalizeCreditScrapeTransaction(normalizeMaxRawTransaction(item.raw)),
      card = text(item.raw.shortCardNumber, 80), suffix = safeSuffix(card),
      key = maxCandidateKey(item.raw, tx),
      sourceKey = creditPendingSourceKey(tx),
      ambiguous = () => safeError(
        'MAX החזירה תצפיות שלא ניתן להכריע אם הן רכישות נפרדות. הריענון נעצר; יש להשוות לפירוט המקור לפני ניסיון נוסף.',
        'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'inconsistent_purchase_evidence' });
    // Do not merge two supplied card identities merely because their suffix matches.
    if (cards.has(suffix) && cards.get(suffix) !== card) throw ambiguous();
    cards.set(suffix, card);
    if (tx.id && seen.has(key)) continue;
    if (tx.id) {
      const id = JSON.stringify([card, tx.id]), previous = sources.get(id) || new Set(),
        purchase = sourceKey ? JSON.stringify([sourceKey, tx.status]) : '';
      // Different complete purchase witnesses may share an issuer ID. A
      // conflicting observation of one purchase is not a second charge.
      if (previous.size && (!sourceKey || previous.has('') || previous.has(purchase))) throw ambiguous();
      previous.add(purchase); sources.set(id, previous);
    } else {
      // Anonymous multiplicity within an issuer list is real input. Identical
      // anonymous observations in separate views lack authority to deduplicate.
      if (anonymousPaths.has(key) && anonymousPaths.get(key) !== item.path) throw ambiguous();
      anonymousPaths.set(key, item.path);
    }
    seen.add(key);
    transactions.push(item.raw);
    uniqueItems.push(item);
    candidatePaths.add(item.path);
  }
  const accountSummary = /** @type {Map<string, MaxAccountEvidence>} */ (new Map()),
    auditRows = [];
  for (const item of uniqueItems) {
    const audit = maxCandidateAudit(item),
      accountSuffix = audit.accountSuffix || '',
      summary = accountSummary.get(accountSuffix) || {
        accountSuffix,
        candidateCount: 0,
        foreignSignalCount: 0,
        offCycleCount: 0,
      };
    summary.candidateCount++;
    if (audit.foreignSignals.length) summary.foreignSignalCount++;
    if (audit.offCyclePayment) summary.offCycleCount++;
    accountSummary.set(accountSuffix, summary);
    if (audit.foreignSignals.length || audit.offCyclePayment) auditRows.push(audit);
  }
  auditRows.sort(
    (a, b) =>
      Number(b.foreignSignals.length > 0) - Number(a.foreignSignals.length > 0) ||
      String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')) ||
      String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || ''))
  );
  const candidateAccountSummary = [...accountSummary.values()].sort((a, b) =>
    String(a.accountSuffix).localeCompare(String(b.accountSuffix))
  );
  return {
    transactions,
    evidence: {
      resultPresent: true,
      resultKeys: Object.keys(result).sort().slice(0, 80),
      arrayPaths: arrayEvidence.slice(0, 80),
      legacyTransactionsCount: Array.isArray(result.transactions) ? result.transactions.length : 0,
      candidateCount: transactions.length,
      candidatePaths: [...candidatePaths].sort().slice(0, 40),
      candidateAccountSummary,
      foreignSignalCandidateCount: candidateAccountSummary.reduce(
        (sum, row) => sum + row.foreignSignalCount,
        0
      ),
      offCycleCandidateCount: candidateAccountSummary.reduce(
        (sum, row) => sum + row.offCycleCount,
        0
      ),
      candidateAuditSamples: auditRows,
      candidateAuditTruncated: false,
    },
  };
}

/** @param {unknown} [raw] @param {ReadonlyMap<number,string>} [categories] */
export function normalizeMaxRawTransaction(raw, categories = new Map()) {
  if (!maxRawLooksLikeTransaction(raw)) return null;
  const purchaseDate = maxProviderDate(raw.purchaseDate);
  if (!purchaseDate) return null;
  const paymentRaw = raw.paymentDate,
    completed = paymentRaw !== null && paymentRaw !== undefined && String(paymentRaw).trim() !== '',
    paymentDate = completed ? maxProviderDate(paymentRaw) : null,
    installments = maxInstallments(raw),
    chargedCurrency = maxChargedCurrency(raw.paymentCurrency),
    originalCurrency = text(raw.originalCurrency, 12),
    actual = maxNumber(raw.actualPaymentAmount),
    original = maxNumber(raw.originalAmount),
    timeEvidence = maxRawTransactionTime(raw),
    foreignTransaction = maxForeignSignalLabels(raw).length > 0;
  if (completed && !paymentDate || paymentRaw != null && typeof paymentRaw !== 'string')
    throw safeError('MAX החזירה תאריך חיוב שאינו תקין. העסקה לא תועבר לרשימה ללא חודש חיוב.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'MaxTransactions',diagnosticReason:'invalid_billing_date' });
  return {
    identifier: maxRawIdentifier(raw, installments),
    type: installments ? 'installments' : 'normal',
    date: purchaseDate,
    processedDate: completed ? paymentDate : null,
    transactionDate: purchaseDate,
    transactionTime: timeEvidence.time,
    originalAmount: original === null ? null : creditDebitAmount(original),
    originalCurrency,
    chargedAmount: actual === null ? null : creditDebitAmount(actual),
    ...(chargedCurrency ? { chargedCurrency } : {}),
    foreignTransaction,
    description: text(raw.merchantName || raw.businessName || 'עסקת MAX', 220) || 'עסקת MAX',
    memo: maxMemo(raw),
    category: categories.get(Number(raw.categoryId)) || undefined,
    installments,
    status: completed ? 'completed' : 'pending',
    rawTransaction: raw,
  };
}

/** @param {unknown} [input] */
export function maxCategories(input) {
  /** @type {Map<number,string>} */
  const map = new Map();
  const rows = providerRecord(input)?.result;
  for (const item of isProviderList(rows) ? rows : []) {
    const row = providerRecord(item);
    const id = Number(row?.id);
    const name = text(row?.name, 160);
    if (Number.isFinite(id) && name) map.set(id, name);
  }
  return map;
}

/** @param {unknown} [input] */
export function maxHomeCards(input) {
  const result = providerRecord(providerRecord(input)?.Result);
  const rows = providerRecord(result?.UserCards)?.Cards;
  /** @type {Map<string,{accountNumber:string,balance:number|null,balanceDate:string|null,cardFrame:number|null,availableCredit:number|null}>} */
  const cards = new Map();
  for (const item of isProviderList(rows) ? rows : []) {
    const row = providerRecord(item);
    const accountNumber = safeSuffix(row?.Last4Digits),
      limit = maxNumber(row?.CreditLimit),
      open = maxNumber(row?.OpenToBuy),
      cycle = isProviderList(row?.CycleSummary) ? row.CycleSummary : [],
      shekel = cycle.find(item => isProviderRecord(item) && String(item.CurrencySymbol || '').includes('₪')),
      balance = limit !== null && open !== null ? Math.round(-(limit - open) * 100) / 100 : null;
    if (accountNumber)
      cards.set(accountNumber, {
        accountNumber,
        balance,
        balanceDate: maxProviderDate(providerRecord(shekel)?.Date),
        cardFrame: limit,
        availableCredit: open,
      });
  }
  return cards;
}

/** @param {string} profileId @param {string} month @param {MaxResponseShape} evidence
 * @param {number} discoveredCardCount @param {Iterable<string>} excludedAccountNumbers */
export function maxResponseEvidence(
  profileId,
  month,
  evidence,
  discoveredCardCount,
  excludedAccountNumbers
) {
  const excluded = new Set([...excludedAccountNumbers].map(safeSuffix).filter(Boolean)),
    candidateAccountSummary = (
      Array.isArray(evidence.candidateAccountSummary) ? evidence.candidateAccountSummary : []
    ).filter((row) => !excluded.has(safeSuffix(row?.accountSuffix))),
    visibleAuditRows = (
      Array.isArray(evidence.candidateAuditSamples) ? evidence.candidateAuditSamples : []
    ).filter((row) => !excluded.has(safeSuffix(row?.accountSuffix))),
    candidateAuditSamples = visibleAuditRows.slice(0, 80);
  return {
    kind: 'providerResponseShape',
    profileId,
    month,
    resultPresent: evidence.resultPresent === true,
    resultKeys: evidence.resultKeys || [],
    arrayPaths: evidence.arrayPaths || [],
    legacyTransactionsCount: Number(evidence.legacyTransactionsCount) || 0,
    candidateCount: Number(evidence.candidateCount) || 0,
    candidatePaths: evidence.candidatePaths || [],
    candidateAccountSummary,
    foreignSignalCandidateCount: candidateAccountSummary.reduce(
      (sum, row) => sum + (Number(row?.foreignSignalCount) || 0),
      0
    ),
    offCycleCandidateCount: candidateAccountSummary.reduce(
      (sum, row) => sum + (Number(row?.offCycleCount) || 0),
      0
    ),
    candidateAuditSamples,
    candidateAuditTruncated: visibleAuditRows.length > candidateAuditSamples.length,
    discoveredCardCount: Number(discoveredCardCount) || 0,
    excludedAccountSuffixes: [...excluded].sort(),
  };
}

/** @param {ProviderRecord} [tx] */
export function enrichMaxTransaction(tx = {}) {
  const raw = providerRecord(tx.rawTransaction),
    timeEvidence = raw ? maxRawTransactionTime(raw) : null;
  return {
    ...tx,
    ...(raw && hasOwn(raw, 'actualPaymentAmount')
      ? { chargedAmount: creditDebitAmount(raw.actualPaymentAmount) }
      : {}),
    ...(raw && hasOwn(raw, 'originalAmount')
      ? { originalAmount: creditDebitAmount(raw.originalAmount) }
      : {}),
    transactionTime: tx?.transactionTime || timeEvidence?.time || '',
  };
}

/** @param {unknown} value */
function maxPurchaseClock(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  /** @type {string[]|null} */
  let match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(raw);
  if (!match && /^\d{3,4}$/.test(raw)) {
    const compact = raw.padStart(4, '0');
    match = [raw, compact.slice(0, 2), compact.slice(2)];
  }
  const dateTime = !match && /[T\s](\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  const parts = match || dateTime;
  if (!parts) return '';
  const hour = Number(parts[1]), minute = Number(parts[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return dateTime && clock === '00:00' ? '' : clock;
}

const MAX_PURCHASE_TIME_PATH = 'dealData.purchaseTime';
/** @param {unknown} rawTransaction */
export function maxRawTransactionTime(rawTransaction) {
  const value = providerRecord(providerRecord(rawTransaction)?.dealData)?.purchaseTime;
  const time = maxPurchaseClock(value);
  if (!time) return { time: '', sourcePath: '', ambiguous: false, candidates: [] };
  const candidate = { path: MAX_PURCHASE_TIME_PATH, time, value };
  return { time, sourcePath: MAX_PURCHASE_TIME_PATH, ambiguous: false, candidates: [candidate] };
}
