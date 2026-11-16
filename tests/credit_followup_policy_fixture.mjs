const purchase=JSON.parse(readFileSync(new URL('./fixtures/credit-purchase-reviewed-changes.json',import.meta.url),'utf8'));
const occurrence=JSON.parse(readFileSync(new URL('./fixtures/credit-occurrence-reviewed-changes.json',import.meta.url),'utf8'));
const restore=JSON.parse(readFileSync(new URL('./fixtures/credit-restore-reviewed-changes.json',import.meta.url),'utf8'));
import {readFileSync} from 'node:fs';
const review=JSON.parse(readFileSync(new URL('./fixtures/credit-followup-reviewed-changes.json',import.meta.url),'utf8'));
const identity=JSON.parse(readFileSync(new URL('./fixtures/credit-identity-reviewed-changes.json',import.meta.url),'utf8'));
export function restoreCreditFollowupChanges(source,file){
  source=source.replaceAll('\r\n','\n');
  for(const change of purchase[file]||[])source=source.replace(change.after,change.before);
  for(const change of occurrence[file]||[])source=source.replace(change.after,change.before);
  for(const change of restore[file]||[])source=source.replace(change.after,change.before);
  for(const change of identity[file]||[])source=source.replace(change.after,change.before);
  for(const change of review[file]||[])source=source.replace(change.after,change.before);
  return source;
}
