import {readFileSync} from 'node:fs';
const review=JSON.parse(readFileSync(new URL('./fixtures/finance-history-reviewed-changes.json',import.meta.url),'utf8'));
export function restoreFinanceHistoryChanges(source,file){
  for(const change of review[file]||[])source=source.replace(change.after,change.before);
  return source;
}
