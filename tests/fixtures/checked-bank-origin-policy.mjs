// @ts-check
import {createBankOriginPolicy,decodeBankOriginConfiguration} from '../../netunim-kupa/bank-bridge/origin-policy.mjs';
const policy=createBankOriginPolicy({version:1,mode:'allowlist'});
/** @type {boolean} */
const allowed=policy.allows('https://bargig-kupa.pages.dev');
decodeBankOriginConfiguration({version:1,mode:'allowlist'}).allowedOrigins[0]?.toUpperCase();
/** @param {import('../../netunim-kupa/bank-bridge/origin-policy.mjs').OriginPolicy} value */
function consume(value){return value}
// @ts-expect-error configuration mode remains an explicit policy choice
consume({...policy,mode:'arbitrary'});
// @ts-expect-error origin decisions cannot become asynchronous authority
consume({...policy,allows:async()=>true});
// @ts-expect-error admission is a boolean rather than a display string
allowed.toUpperCase();
