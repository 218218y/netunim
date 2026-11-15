import {readFileSync} from 'node:fs';
const review=JSON.parse(readFileSync(new URL('./fixtures/credit-followup-reviewed-changes.json',import.meta.url),'utf8'));
const identity=JSON.parse(readFileSync(new URL('./fixtures/credit-identity-reviewed-changes.json',import.meta.url),'utf8'));
export function restoreCreditFollowupChanges(source,file){
  source=source.replaceAll('\r\n','\n');
  for(const change of identity[file]||[])source=source.replace(change.after,change.before);
  for(const change of review[file]||[])source=source.replace(change.after,change.before);
  return source;
}
