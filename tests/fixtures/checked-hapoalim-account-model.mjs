import {selectAccountDescriptor,publicAccountDescriptors} from '../../netunim-kupa/bank-bridge/hapoalim-account-model.mjs';
/** @type {unknown} */ const raw=[];
const selected=selectAccountDescriptor(raw,{branchNumber:'12',accountNumber:'345'});
/** @type {string} */ const account=selected.accountNumber;
/** @type {string} */ const identity=selected.accountId;
// @ts-expect-error normalization does not turn arbitrary provider metadata into verified money
/** @type {number} */ const balance=selected.balance;
// @ts-expect-error account identity must remain textual
selected.accountNumber=12;
const descriptors=publicAccountDescriptors(raw);
// @ts-expect-error public account descriptors do not expose raw balance metadata
descriptors[0]?.balance;
void [account,identity,balance];
