import {readRestoreApplyReceipt,readRestoreStageReceipt} from '../../shared/restore-response-records.js';
/** @type {unknown} */ const input=[];
const receipt=readRestoreApplyReceipt(input,'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
/** @type {number} */ const revision=receipt.main_revision;
/** @type {number|null} */ const checks=receipt.checks_revision;
// @ts-expect-error a receipt cannot be mutated into authority
receipt.main_revision=1;
// @ts-expect-error identity cannot be inferred from an arbitrary number
readRestoreStageReceipt(input,1);
void [revision,checks];
