import * as diagnostics from '../netunim-kupa/bank-bridge/bank-diagnostics.mjs';
import { createHapoalimJsonReader } from '../netunim-kupa/bank-bridge/hapoalim-json.mjs';
import { createHapoalimEnrichment } from '../netunim-kupa/bank-bridge/hapoalim-enrichment.mjs';
import { createHapoalimAccountReader } from '../netunim-kupa/bank-bridge/hapoalim-accounts.mjs';
export function readerFixture({
  respond,
  accounts,
  attach = async (page, transaction, payload, normalized) => normalized,
} = {}) {
  const calls = [],
    bankAccounts = accounts || [
      { bankNumber: 12, branchNumber: 345, accountNumber: 678901, accountClosingReasonCode: 0 },
    ],
    href = 'https://login.bankhapoalim.co.il/dashboard';
  const ready = { ready: true, href, restContext: 'fixture', accounts: bankAccounts },
    run = diagnostics.createBankDiagnosticRun({ bridgeVersion: 73 });
  let now = new Date('2026-10-13T12:00:00Z');
  const clock = { date: () => new Date(now) };
  const page = {
    url: () => href,
    cookies: async () => [{ name: 'XSRF-TOKEN', value: 'fixture-xsrf' }],
    evaluate: async (callback, request) => {
      calls.push(['request', request]);
      const url = new URL(request.url);
      const data = await (respond
        ? respond(url, request)
        : url.pathname.endsWith('balanceAndCreditLimit')
          ? { currentBalance: 42 }
          : { transactions: [] });
      if (data?.httpFailure)
        return { ok: false, status: data.httpFailure, data: null, text: 'fixture failure' };
      return { ok: true, status: 200, data, text: '' };
    },
  };
  const session = {
    ready: async () => {
      calls.push(['ready']);
      return ready;
    },
  };
  const json = createHapoalimJsonReader({ session });
  const enrichment = createHapoalimEnrichment({
    json,
    cheques: { attach },
    diagnostics: { recordTransaction: diagnostics.recordBankTransactionDiagnostic },
  });
  const reader = createHapoalimAccountReader({
    session,
    json,
    enrichment,
    diagnostics: { recordAccount: diagnostics.recordBankAccountDiagnostic },
    clock,
  });
  const api = { read: reader.read, enrich: enrichment.enrich, json };
  return { api, page, ready, run, calls, clock, session, attach, respond };
}
