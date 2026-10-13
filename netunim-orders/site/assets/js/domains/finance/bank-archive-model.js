import { normalizeBankFeed } from './bank-feed.js';

export function bankArchiveTargets(bank = {}) {
  return [
    ['business', normalizeBankFeed(bank.feed)],
    ['home', normalizeBankFeed(bank.homeFeed)],
  ]
    .filter(([, feed]) => !!feed?.accountNumber)
    .map(([role, feed]) => ({
      role,
      accountKey: String(feed.accountNumber || ''),
      syncKey: String(feed.syncedAt || ''),
    }));
}
export function bankArchiveSourceRows(bank = {}) {
  return [bank.feed?.transactions, bank.homeFeed?.transactions].filter(Array.isArray);
}
export function projectBankArchiveFeed(archive, role, feed) {
  const normalized = normalizeBankFeed(feed);
  if (!normalized) return null;
  const current = archive.queries.matching(role, normalized.accountNumber, normalized.syncedAt);
  return current
    ? normalizeBankFeed({
        ...normalized,
        transactions: current.rows,
        directSnapshot: current.directSnapshot,
      })
    : normalized;
}
