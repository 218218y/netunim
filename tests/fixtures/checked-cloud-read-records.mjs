import {readCloudDocumentRows,readFinanceDocumentRows,readCloudBackupPointRows} from '../../shared/cloud-read-records.js';
/** @type {unknown} */ const input={};
const document=readCloudDocumentRows(input,'main'),finance=readFinanceDocumentRows(input,'main');
if(document){
  /** @type {number} */ const revision=document.revision;
  // @ts-expect-error a decoded revision is not a coercible string
  /** @type {string} */ const text=document.revision;
  // @ts-expect-error document state has no invented domain-specific row type
  document.state.notes[0].id.toUpperCase();
  void [revision,text];
}
// @ts-expect-error restore identity must already be numeric authority
readCloudBackupPointRows(input,'1');
void finance;
