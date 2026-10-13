// @ts-nocheck
import { hasOwn, safeDate, safeSuffix, text } from './credit-value-codec.mjs';
import { maxRawTransactionTime } from './credit-data-diagnostics.mjs';
import { creditDebitAmount } from './credit-core-values.mjs';

function maxNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value)
    .trim()
    .replace(/[₪$€\s]/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '');
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function maxProviderDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim(),
    dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (dmy) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dmy,
      time = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ),
      date = new Date(time);
    if (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
    )
      return date.toISOString();
  }
  return safeDate(raw);
}

function maxChargedCurrency(value) {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (['376', 'ILS', 'NIS', '₪', 'ש"ח', 'ש״ח', 'שח'].includes(raw)) return 'ILS';
  if (['840', 'USD', '$'].includes(raw)) return 'USD';
  if (['978', 'EUR', '€'].includes(raw)) return 'EUR';
  return raw && raw.length <= 12 ? raw : '';
}

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

function maxMemo(raw = {}) {
  const comments = text(raw.comments, 180),
    receiver = text(raw.fundsTransferReceiverOrTransfer, 120),
    detail = text(raw.fundsTransferComment, 120),
    base = [comments, receiver].filter(Boolean).join(' ');
  return detail ? [base, detail].filter(Boolean).join(': ') : base;
}

function maxRawIdentifier(raw = {}, installments = null) {
  const candidates = [
      raw?.dealData?.arn,
      raw?.dealData?.transactionId,
      raw?.transactionId,
      raw?.dealId,
      raw?.referenceNumber,
    ]
      .map((value) => text(value, 100))
      .filter(Boolean),
    base = candidates[0] || '';
  return base && installments?.number ? `${base}_${installments.number}` : base;
}

function maxRawLooksLikeTransaction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
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

function maxWalkTransactionCandidates(
  value,
  path = 'result',
  out = [],
  arrayEvidence = [],
  depth = 0
) {
  if (depth > 10 || value === null || value === undefined) return { out, arrayEvidence };
  if (Array.isArray(value)) {
    const firstObject = value.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item)
    );
    arrayEvidence.push({
      path: text(path, 180),
      count: value.length,
      sampleKeys: firstObject ? Object.keys(firstObject).sort().slice(0, 50) : [],
    });
    value.forEach((item, index) =>
      maxWalkTransactionCandidates(item, `${path}[${index}]`, out, arrayEvidence, depth + 1)
    );
    return { out, arrayEvidence };
  }
  if (typeof value !== 'object') return { out, arrayEvidence };
  if (maxRawLooksLikeTransaction(value))
    out.push({ raw: value, path: text(path.replace(/\[\d+\]/g, '[]'), 180) });
  for (const [key, child] of Object.entries(value))
    maxWalkTransactionCandidates(child, `${path}.${key}`, out, arrayEvidence, depth + 1);
  return { out, arrayEvidence };
}

function maxCandidateKey(raw = {}) {
  const arn = text(raw?.dealData?.arn || raw?.transactionId || raw?.dealId || '', 120);
  if (arn) return `id:${arn}|${text(raw.comments, 80)}`;
  return JSON.stringify([
    safeSuffix(raw.shortCardNumber),
    text(raw.purchaseDate, 60),
    text(raw.paymentDate, 60),
    text(raw.merchantName || raw.businessName, 120),
    maxNumber(raw.originalAmount),
    text(raw.originalCurrency, 12),
    maxNumber(raw.actualPaymentAmount),
    String(raw.paymentCurrency ?? ''),
    text(raw.planName, 80),
    text(raw.comments, 120),
  ]);
}

function maxForeignSignalLabels(raw = {}) {
  const labels = [],
    currencies = [
      ['originalCurrency', maxChargedCurrency(raw.originalCurrency)],
      ['paymentCurrency', maxChargedCurrency(raw.paymentCurrency)],
      ['issuerCurrency', maxChargedCurrency(raw?.dealData?.issuerCurrency)],
    ];
  for (const [field, currency] of currencies)
    if (currency && currency !== 'ILS') labels.push(`${field}:${currency}`);
  const exchangeRate = maxNumber(raw?.dealData?.exchangeRate),
    issuerExchangeRate = maxNumber(raw?.dealData?.issuerExchangeRate);
  if (exchangeRate !== null && exchangeRate !== 0) labels.push('exchangeRate');
  if (issuerExchangeRate !== null && issuerExchangeRate !== 0) labels.push('issuerExchangeRate');
  const wording = [raw.planName, raw.comments, raw.fundsTransferComment]
    .map((value) => String(value || ''))
    .join(' ');
  if (/חו["״']?ל|מט["״']?ח|foreign|currency|overseas/i.test(wording)) labels.push('providerText');
  return [...new Set(labels)].slice(0, 12);
}

function maxOffCyclePayment(raw = {}) {
  const date = maxProviderDate(raw.paymentDate);
  if (!date) return false;
  const day = new Date(date).getUTCDate();
  return day < 7 || day > 18;
}

function maxCandidateAudit(item = {}) {
  const raw = item.raw || {},
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
    issuerCurrency: maxChargedCurrency(raw?.dealData?.issuerCurrency),
    exchangeRate: maxNumber(raw?.dealData?.exchangeRate),
    issuerExchangeRate: maxNumber(raw?.dealData?.issuerExchangeRate),
    foreignSignals,
    offCyclePayment,
  };
}

export function extractMaxTransactionCandidates(data = {}) {
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data.result : null;
  if (!result || typeof result !== 'object')
    return {
      transactions: [],
      evidence: {
        resultPresent: false,
        resultKeys: [],
        arrayPaths: [],
        legacyTransactionsCount: 0,
        candidateCount: 0,
        candidatePaths: [],
        candidateAccountSummary: [],
        foreignSignalCandidateCount: 0,
        offCycleCandidateCount: 0,
        candidateAuditSamples: [],
        candidateAuditTruncated: false,
      },
    };
  const { out, arrayEvidence } = maxWalkTransactionCandidates(result),
    seen = new Set(),
    transactions = [],
    uniqueItems = [],
    candidatePaths = new Set();
  for (const item of out) {
    const key = maxCandidateKey(item.raw);
    if (seen.has(key)) continue;
    seen.add(key);
    transactions.push(item.raw);
    uniqueItems.push(item);
    candidatePaths.add(item.path);
  }
  const accountSummary = new Map(),
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

export function normalizeMaxRawTransaction(raw = {}, categories = new Map()) {
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

export function maxCategories(data = {}) {
  const map = new Map(),
    rows = Array.isArray(data?.result) ? data.result : [];
  for (const row of rows) {
    const id = Number(row?.id),
      name = text(row?.name, 160);
    if (Number.isFinite(id) && name) map.set(id, name);
  }
  return map;
}

export function maxHomeCards(data = {}) {
  const rows = Array.isArray(data?.Result?.UserCards?.Cards) ? data.Result.UserCards.Cards : [],
    cards = new Map();
  for (const row of rows) {
    const accountNumber = safeSuffix(row?.Last4Digits),
      limit = maxNumber(row?.CreditLimit),
      open = maxNumber(row?.OpenToBuy),
      cycle = Array.isArray(row?.CycleSummary) ? row.CycleSummary : [],
      shekel = cycle.find((item) => String(item?.CurrencySymbol || '').includes('₪')),
      balance = limit !== null && open !== null ? Math.round(-(limit - open) * 100) / 100 : null;
    if (accountNumber)
      cards.set(accountNumber, {
        accountNumber,
        balance,
        balanceDate: maxProviderDate(shekel?.Date),
        cardFrame: limit,
        availableCredit: open,
      });
  }
  return cards;
}

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

export function enrichMaxTransaction(tx = {}) {
  const raw =
      tx?.rawTransaction && typeof tx.rawTransaction === 'object' ? tx.rawTransaction : null,
    timeEvidence = raw ? maxRawTransactionTime(raw) : null;
  return {
    ...tx,
    ...(hasOwn(raw, 'actualPaymentAmount')
      ? { chargedAmount: creditDebitAmount(raw.actualPaymentAmount) }
      : {}),
    ...(hasOwn(raw, 'originalAmount')
      ? { originalAmount: creditDebitAmount(raw.originalAmount) }
      : {}),
    transactionTime: tx?.transactionTime || timeEvidence?.time || '',
  };
}
