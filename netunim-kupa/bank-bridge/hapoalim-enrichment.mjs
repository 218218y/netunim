import {
  buildHapoalimAdditionalDetailsUrl,
  normalizeHapoalimAdditionalDetails,
  mergeHapoalimAdditionalDetails,
} from './hapoalim-additional-details-model.mjs';
import { hapoalimChequeTransactionKind } from './hapoalim-cheque-model.mjs';
import {
  hapoalimCreditSettlementProvider,
  isHapoalimCompletedCreditSettlement,
  isHapoalimCreditPermissionDetails,
  normalizeHapoalimCreditPermissionDetails,
  mergeHapoalimCreditPermissionDetails,
} from './hapoalim-credit-settlement-model.mjs';
import { normalizeHapoalimTransaction } from './hapoalim-transaction-model.mjs';
import { HAPOALIM_BASE_URL } from './hapoalim-wire.mjs';
export function createHapoalimEnrichment({ json, cheques, diagnostics }) {
  if (
    typeof json?.read !== 'function' ||
    typeof cheques?.attach !== 'function' ||
    typeof diagnostics?.recordTransaction !== 'function'
  )
    throw new Error('bank_enrichment_ports_required');
  const pageFetchJson = json.read,
    attachChequeImageKeys = cheques.attach,
    recordBankTransactionDiagnostic = diagnostics.recordTransaction;
  async function enrichHapoalimTransactions(
    page,
    rawTransactions,
    accountId,
    { initialReady = null, role = 'business', diagnosticRun = null } = {}
  ) {
    const source = Array.isArray(rawTransactions) ? rawTransactions : [];
    const enriched = [];
    let reusableReady = initialReady;
    for (const transaction of source) {
      const pfmDetails = String(transaction?.pfmDetails || '').trim();
      const transactionDetails = String(transaction?.details || '').trim();
      const chequeKind = hapoalimChequeTransactionKind(transaction);
      const creditProvider = hapoalimCreditSettlementProvider(transaction);
      if (!chequeKind && creditProvider) {
        if (!isHapoalimCompletedCreditSettlement(transaction)) {
          recordBankTransactionDiagnostic(diagnosticRun, {
            role,
            chequeKind: '',
            transaction,
            normalizedTransaction: normalizeHapoalimTransaction(transaction),
            detailSources: [],
            mergedAdditionalDetails: null,
          });
          enriched.push(transaction);
          continue;
        }
        const creditSources = [],
          warnings = [],
          diagnosticSources = [];
        const fetchCreditSource = async (relativeUrl, label) => {
          try {
            const requestUrl = buildHapoalimAdditionalDetailsUrl(
              HAPOALIM_BASE_URL,
              relativeUrl,
              accountId
            );
            const extraResult = await pageFetchJson(page, async () => ({ url: requestUrl }), {
              initialReady: reusableReady,
            });
            reusableReady = extraResult.ready;
            const normalized = normalizeHapoalimCreditPermissionDetails(extraResult.data);
            creditSources.push(normalized);
            diagnosticSources.push({
              source: label,
              request: requestUrl,
              response: extraResult.data,
              normalized,
            });
            return normalized;
          } catch (error) {
            warnings.push(`${label}: ${error?.message || error}`);
            diagnosticSources.push({
              source: label,
              request: relativeUrl,
              response: null,
              normalized: null,
              error: {
                code: error?.code || '',
                stage: error?.stage || '',
                httpStatus: Number(error?.httpStatus) || 0,
                message: error?.message || String(error),
              },
            });
            reusableReady = null;
            return null;
          }
        };
        if (pfmDetails) await fetchCreditSource(pfmDetails, 'פרטי אסמכתת חיוב אשראי');
        if (isHapoalimCreditPermissionDetails(transaction) && transactionDetails !== pfmDetails)
          await fetchCreditSource(transactionDetails, 'פירוט הרשאת חיוב אשראי');
        const merged = mergeHapoalimCreditPermissionDetails(...creditSources),
          creditDetails = {
            ...merged,
            detailFetched: creditSources.length > 0,
            ...(warnings.length
              ? {
                  warning: `לא ניתן היה לטעון את כל פירוט חיוב האשראי מהבנק: ${warnings.join(' | ')}`,
                }
              : {}),
          };
        const enrichedTransaction = {
          ...transaction,
          netunimCreditSettlementDetails: creditDetails,
        };
        recordBankTransactionDiagnostic(diagnosticRun, {
          role,
          chequeKind: '',
          transaction,
          normalizedTransaction: normalizeHapoalimTransaction(enrichedTransaction),
          detailSources: diagnosticSources,
          mergedAdditionalDetails: { creditSettlementDetails: creditDetails },
        });
        enriched.push(enrichedTransaction);
        continue;
      }
      if (!chequeKind) {
        recordBankTransactionDiagnostic(diagnosticRun, {
          role,
          chequeKind: '',
          transaction,
          normalizedTransaction: normalizeHapoalimTransaction(transaction),
          detailSources: [],
          mergedAdditionalDetails: null,
        });
        enriched.push(transaction);
        continue;
      }
      const detailSources = [],
        warnings = [],
        diagnosticSources = [];
      if ((!pfmDetails && !transactionDetails) || Number(transaction?.serialNumber) === 0) {
        recordBankTransactionDiagnostic(diagnosticRun, {
          role,
          chequeKind,
          transaction,
          normalizedTransaction: normalizeHapoalimTransaction(transaction),
          detailSources: [],
          mergedAdditionalDetails: null,
        });
        enriched.push(transaction);
        continue;
      }
      let pfmNormalized = null;
      const fetchDetailSource = async (relativeUrl, label, includeTransaction = false) => {
        try {
          const requestUrl = buildHapoalimAdditionalDetailsUrl(
            HAPOALIM_BASE_URL,
            relativeUrl,
            accountId
          );
          const extraResult = await pageFetchJson(page, async () => ({ url: requestUrl }), {
            initialReady: reusableReady,
          });
          reusableReady = extraResult.ready;
          let normalized = normalizeHapoalimAdditionalDetails(
            includeTransaction
              ? { transaction, additionalInformation: extraResult.data }
              : { additionalInformation: extraResult.data }
          );
          if (!includeTransaction)
            normalized = await attachChequeImageKeys(
              page,
              transaction,
              extraResult.data,
              normalized
            );
          detailSources.push(normalized);
          diagnosticSources.push({
            source: label,
            request: requestUrl,
            response: extraResult.data,
            normalized,
          });
          return normalized;
        } catch (error) {
          warnings.push(`${label}: ${error?.message || error}`);
          diagnosticSources.push({
            source: label,
            request: relativeUrl,
            response: null,
            normalized: null,
            error: {
              code: error?.code || '',
              stage: error?.stage || '',
              httpStatus: Number(error?.httpStatus) || 0,
              message: error?.message || String(error),
            },
          });
          reusableReady = null;
          return null;
        }
      };
      if (pfmDetails) pfmNormalized = await fetchDetailSource(pfmDetails, 'פרטי אסמכתה', true);
      // Hapoalim exposes a second per-transaction `details` link. For cheque rows this can point
      // at the dedicated /current-account/cheques/... endpoint used by the bank's expanded UI.
      // Keep it separate from PFM so a cheque-row reference can never replace the deposit reference.
      if (transactionDetails && transactionDetails !== pfmDetails)
        await fetchDetailSource(transactionDetails, 'פירוט שיקים', false);
      const details = mergeHapoalimAdditionalDetails(...detailSources);
      const enrichedTransaction = {
        ...transaction,
        ...(chequeKind === 'deposit' && pfmNormalized?.referenceNumber
          ? { referenceNumber: pfmNormalized.referenceNumber }
          : {}),
        ...(detailSources.length ? { netunimAdditionalDetails: details } : {}),
        ...(warnings.length
          ? {
              netunimAdditionalDetailsWarning: `לא ניתן היה לטעון את כל פירוט השיק מהבנק: ${warnings.join(' | ')}`,
            }
          : {}),
      };
      recordBankTransactionDiagnostic(diagnosticRun, {
        role,
        chequeKind,
        transaction,
        normalizedTransaction: normalizeHapoalimTransaction(enrichedTransaction),
        detailSources: diagnosticSources,
        mergedAdditionalDetails: details,
      });
      enriched.push(enrichedTransaction);
    }
    return { transactions: enriched, ready: reusableReady };
  }
  return Object.freeze({ enrich: enrichHapoalimTransactions });
}
