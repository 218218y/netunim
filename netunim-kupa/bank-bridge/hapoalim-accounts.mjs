import { randomUUID } from 'node:crypto';
import {
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_INITIAL_BACKFILL_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
} from './hapoalim-policy.mjs';
import {
  hapoalimTransactionPageState,
  normalizeRecentTransactions,
} from './hapoalim-transaction-model.mjs';
import { selectAccountDescriptor } from './hapoalim-account-model.mjs';
import { ymdDate } from './hapoalim-date-codec.mjs';
import { HAPOALIM_BASE_URL } from './hapoalim-wire.mjs';
import { stageError, runStage } from './provider-errors.mjs';
import { bankBridgeErrorResponse as safeError } from './wire-errors.mjs';
export function createHapoalimAccountReader({ session, json, enrichment, diagnostics, clock }) {
  if (
    typeof session?.ready !== 'function' ||
    typeof json?.read !== 'function' ||
    typeof enrichment?.enrich !== 'function' ||
    typeof diagnostics?.recordAccount !== 'function' ||
    typeof clock?.date !== 'function'
  )
    throw new Error('bank_account_ports_required');
  const waitForHapoalimSessionReady = session.ready,
    pageFetchJson = json.read,
    enrichHapoalimTransactions = enrichment.enrich,
    recordBankAccountDiagnostic = diagnostics.recordAccount;
  async function fetchHapoalimAccountSnapshot(
    page,
    selected,
    ready,
    historyDays = HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
    { role = 'business', diagnosticRun = null } = {}
  ) {
    const accountId = selected.accountId;
    const balanceResult = await runStage(
      'balance',
      () =>
        pageFetchJson(
          page,
          async (current) => {
            const restContext = String(current.restContext || '').replace(/^\/+/, '');
            const apiSiteUrl = `${HAPOALIM_BASE_URL}/${restContext}`;
            return {
              url: `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${encodeURIComponent(accountId)}&view=details&lang=he`,
            };
          },
          { initialReady: ready }
        ),
      'BALANCE_FETCH_FAILED'
    );
    const balanceData = balanceResult.data,
      balanceReady = balanceResult.ready;
    const balance = Number(balanceData?.currentBalance);
    const availableBalance = Number.isFinite(Number(balanceData?.withdrawalBalance))
      ? Number(balanceData.withdrawalBalance)
      : null;
    const creditLimit = Number.isFinite(Number(balanceData?.creditLimitAmount))
      ? Number(balanceData.creditLimitAmount)
      : null;
    const creditLimitUsed = Number.isFinite(Number(balanceData?.creditLimitUtilizationAmount))
      ? Number(balanceData.creditLimitUtilizationAmount)
      : null;
    const creditLimitUsedPercent = Number.isFinite(
      Number(balanceData?.creditLimitUtilizationPercent)
    )
      ? Number(balanceData.creditLimitUtilizationPercent)
      : null;
    if (!Number.isFinite(balance))
      throw stageError(
        'balance',
        Object.assign(new Error('בנק הפועלים לא החזיר יתרת עו״ש מספרית לחשבון שנבחר'), {
          code: 'NO_BALANCE',
        })
      );

    const end = clock.date(),
      days = Math.min(
        HAPOALIM_INITIAL_BACKFILL_DAYS,
        Math.max(1, Number(historyDays) || HAPOALIM_TRANSACTION_LOOKBACK_DAYS)
      );
    const coverageStart = new Date(end);
    coverageStart.setDate(coverageStart.getDate() - (days - 1));
    const isoLocalDate = (value) => {
      const compact = ymdDate(value);
      return compact ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : '';
    };
    let transactions = [],
      transactionWarning = '',
      reusableReady = balanceReady;
    let transactionCoverage = {
      complete: false,
      from: isoLocalDate(coverageStart),
      to: isoLocalDate(end),
      days,
    };
    try {
      const all = [],
        coverageWarnings = [];
      async function fetchWindow(windowStart, windowEnd) {
        const txResult = await pageFetchJson(
          page,
          async (current) => {
            const restContext = String(current.restContext || '').replace(/^\/+/, '');
            const apiSiteUrl = `${HAPOALIM_BASE_URL}/${restContext}`;
            const cookies = await page.cookies(),
              xsrf = String(cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')?.value || '');
            const headers = {
              'Content-Type': 'application/json;charset=UTF-8',
              'pageUuid': '/current-account/transactions',
              'uuid': randomUUID(),
            };
            if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
            return {
              url: `${apiSiteUrl}/current-account/transactions?accountId=${encodeURIComponent(accountId)}&numItemsPerPage=${HAPOALIM_TRANSACTION_LIMIT}&retrievalEndDate=${ymdDate(windowEnd)}&retrievalStartDate=${ymdDate(windowStart)}&sortCode=1`,
              method: 'POST',
              headers,
              body: '[]',
            };
          },
          { initialReady: reusableReady }
        );
        reusableReady = txResult.ready;
        const pageState = hapoalimTransactionPageState(txResult.data, HAPOALIM_TRANSACTION_LIMIT),
          raw = pageState.transactions;
        const startDay = ymdDate(windowStart),
          endDay = ymdDate(windowEnd),
          dayIndex = (value) =>
            Date.UTC(
              Number(value.slice(0, 4)),
              Number(value.slice(4, 6)) - 1,
              Number(value.slice(6, 8))
            ) / 86400000,
          spanDays = Math.max(1, dayIndex(endDay) - dayIndex(startDay) + 1);
        if (pageState.isFull && spanDays > 1) {
          const mid = new Date(windowStart);
          mid.setDate(mid.getDate() + Math.floor((spanDays - 1) / 2));
          const next = new Date(mid);
          next.setDate(next.getDate() + 1);
          await fetchWindow(windowStart, mid);
          await fetchWindow(next, windowEnd);
          return;
        }
        if (pageState.isFull) {
          const day = isoLocalDate(windowStart),
            limit = pageState.effectivePageSize || raw.length;
          coverageWarnings.push(
            `ב-${day} הבנק החזיר ${raw.length} תנועות בגבול העמוד (${limit}); התנועות שהתקבלו נשמרו, אך ייתכן שחסרות תנועות נוספות באותו יום.`
          );
        }
        const enriched = await enrichHapoalimTransactions(page, raw, accountId, {
          initialReady: reusableReady,
          role,
          diagnosticRun,
        });
        reusableReady = enriched.ready || reusableReady;
        all.push(...enriched.transactions);
      }
      const chunkDays = days > HAPOALIM_TRANSACTION_LOOKBACK_DAYS ? 60 : days;
      for (let offset = 0; offset < days; offset += chunkDays) {
        const chunkEnd = new Date(end);
        chunkEnd.setDate(chunkEnd.getDate() - offset);
        const chunkStart = new Date(chunkEnd);
        chunkStart.setDate(chunkStart.getDate() - Math.min(chunkDays - 1, days - offset - 1));
        await fetchWindow(chunkStart, chunkEnd);
      }
      transactions = normalizeRecentTransactions(all, all.length);
      transactionCoverage = { ...transactionCoverage, complete: coverageWarnings.length === 0 };
      if (coverageWarnings.length) transactionWarning = coverageWarnings.join(' ');
    } catch (e) {
      transactionWarning = `היתרה התקבלה, אבל לא ניתן היה לטעון כרגע תנועות אחרונות: ${e?.message || e}`;
    }

    recordBankAccountDiagnostic(diagnosticRun, {
      role,
      bankNumber: selected.bankNumber || '12',
      branchNumber: selected.branchNumber,
      accountNumber: selected.accountNumber,
      balance,
      availableBalance,
      creditLimit,
      creditLimitUsed,
      creditLimitUsedPercent,
      transactionCoverage,
      transactionWarning,
      normalizedTransactionCount: transactions.length,
    });
    return {
      snapshot: {
        balance,
        availableBalance,
        creditLimit,
        creditLimitUsed,
        creditLimitUsedPercent,
        accountNumber: selected.accountNumber,
        branchNumber: selected.branchNumber,
        accountId,
        transactions,
        transactionWarning,
        transactionCoverage,
      },
      ready: reusableReady,
    };
  }

  function configuredAccountSelector(credentials, role) {
    const home = role === 'home';
    return {
      bankNumber: '12',
      branchNumber: home
        ? credentials.homeBranchNumber || ''
        : credentials.businessBranchNumber || credentials.branchNumber || '',
      accountNumber: home
        ? credentials.homeAccountNumber || ''
        : credentials.businessAccountNumber || credentials.accountNumber || '',
    };
  }

  function selectConfiguredAccount(openAccounts, credentials, role) {
    const selector = configuredAccountSelector(credentials, role);
    try {
      return selectAccountDescriptor(openAccounts, selector);
    } catch (error) {
      error.accountRole = role;
      throw error;
    }
  }

  async function fetchSelectedHapoalimSnapshot(
    page,
    credentials,
    ready,
    historyDays = HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
    { diagnosticRun = null } = {}
  ) {
    const stableReady = ready?.ready
      ? ready
      : await waitForHapoalimSessionReady(page, {
          timeoutMs: 20000,
          pollMs: 300,
          stableMs: HAPOALIM_NAVIGATION_STABLE_MS,
        });
    const rawAccounts = Array.isArray(stableReady?.accounts) ? stableReady.accounts : [];
    const openAccounts = rawAccounts.filter(
      (account) => Number(account?.accountClosingReasonCode) === 0
    );
    const businessSelected = await runStage(
      'account',
      () => Promise.resolve(selectConfiguredAccount(openAccounts, credentials, 'business')),
      'ACCOUNT_SELECTION_FAILED'
    );
    const homeRequested = !!(credentials.homeBranchNumber || credentials.homeAccountNumber);
    let homeSelected = null,
      homeFailure = null;
    if (homeRequested) {
      try {
        homeSelected = await runStage(
          'account',
          () => Promise.resolve(selectConfiguredAccount(openAccounts, credentials, 'home')),
          'ACCOUNT_SELECTION_FAILED'
        );
      } catch (error) {
        homeFailure = safeError(error);
      }
    }
    if (homeSelected && homeSelected.accountId === businessSelected.accountId) {
      homeFailure = safeError(
        stageError(
          'account',
          Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'), {
            code: 'DUPLICATE_ACCOUNT_ROLE',
            accountRole: 'home',
          }),
          'ACCOUNT_SELECTION_FAILED'
        )
      );
      homeSelected = null;
    }
    const businessResult = await fetchHapoalimAccountSnapshot(
      page,
      businessSelected,
      stableReady,
      historyDays,
      { role: 'business', diagnosticRun }
    );
    let homeResult = null;
    if (homeSelected && !homeFailure) {
      try {
        homeResult = await fetchHapoalimAccountSnapshot(
          page,
          homeSelected,
          businessResult.ready,
          historyDays,
          { role: 'home', diagnosticRun }
        );
      } catch (error) {
        error.accountRole = 'home';
        homeFailure = safeError(error);
      }
    }
    const business = businessResult.snapshot,
      home = homeResult?.snapshot || null;
    const sessionHref = String(
      page?.url?.() ||
        homeResult?.ready?.href ||
        businessResult.ready?.href ||
        stableReady?.href ||
        ''
    );
    return {
      ...business,
      accounts: { business, home },
      accountFailures: { home: homeFailure },
      sessionHref,
    };
  }
  return Object.freeze({
    read: fetchSelectedHapoalimSnapshot,
    lookbackDays: HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  });
}
