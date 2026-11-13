import {readFileSync} from 'node:fs';
const review=JSON.parse(readFileSync(new URL('./fixtures/credit-month-integrity-reviewed-changes.json',import.meta.url),'utf8'));
// Reverse only the exact reviewed integrity/retention/notification deltas.
// Immutable older baselines still cover all other workflow and financial code.
export function restoreCreditMonthIntegrity(source,file){
  for(const change of review.changes[file]||[])source=source.replace(change.after,change.before);
  return source;
}
