import {expenseCents} from './morning-expense-input.js';

// Calculate in whole agorot. The original field remains editable and manual VAT
// is never replaced unless the user edits a calculation's source amount again.
export function expenseAmountChange(amounts, field, rate = 18) {
  if (![16, 18].includes(rate)) throw new Error('invalid_expense_vat_rate');
  const cents = expenseCents(amounts[field]);
  if (cents === null) return {};
  const money = value => (value / 100).toFixed(2);
  if (field === 'gross') {
    const net = Math.round(cents * 100 / (100 + rate));
    return {net:money(net), vat:money(cents - net)};
  }
  if (field === 'net') {
    const vat = Math.round(cents * rate / 100);
    return {vat:money(vat), gross:money(cents + vat)};
  }
  if (field === 'vat') {
    const net = expenseCents(amounts.net);
    return net === null ? {} : {gross:money(net + cents)};
  }
  return {};
}

// A plausibility check, not a replacement for printed VAT. Mixed/exempt
// transactions may legitimately differ. Ten agorot absorb small roundings;
// larger differences remain visible and are repeated in the final confirmation.
export function expenseAmountSanity(amounts, rate = 18) {
  if (![16,18].includes(rate)) throw new Error('invalid_expense_vat_rate');
  const net = expenseCents(amounts.net), vat = expenseCents(amounts.vat), gross = expenseCents(amounts.gross);
  if ([net,vat,gross].some(value => value === null)) return {status:'incomplete',rate};
  if (net + vat !== gross) return {status:'inconsistent',rate};
  const expectedVatCents = Number((BigInt(net) * BigInt(rate) + 50n) / 100n);
  const differenceCents = vat - expectedVatCents;
  return {status:Math.abs(differenceCents) <= 10 ? 'plausible' : 'different_rate',rate,expectedVatCents,differenceCents};
}
