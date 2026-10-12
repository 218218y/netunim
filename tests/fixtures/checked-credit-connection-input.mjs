import {readCreditConnectionInput} from '../../netunim-kupa/site/assets/js/ui/credit-connection-input.js';
const input=readCreditConnectionInput('profile',field=>field==='ccCard6'?'001234':'');
/** @type {string} */ const suffix=input.card6Digits;
void suffix;
// @ts-expect-error credential fields must remain strings, including leading zeros
readCreditConnectionInput('profile',()=>123);
// @ts-expect-error a form profile ID is explicit text
readCreditConnectionInput(123,()=> '');
// @ts-expect-error the command has a fixed wire shape
input.credentials={password:'secret'};
