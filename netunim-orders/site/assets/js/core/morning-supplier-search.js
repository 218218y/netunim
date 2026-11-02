import {normalizeSearchText,searchMatch} from './search.js';

// Plene Hebrew spellings may double vav/yod. This is a name-search alias only;
// stored names, tax identity, invoice identifiers and other fields stay exact.
const nameAlias=value=>normalizeSearchText(value).replace(/([וי])\1+/g,'$1');
export function supplierSearchMatch(query,supplier,values=[supplier.name,supplier.taxId]){
  if(searchMatch(query,values))return true;
  const name=nameAlias(supplier.name);
  const text=normalizeSearchText(query).split(' ').map(token=>
    /[א-ת]/.test(token)&&searchMatch(nameAlias(token),[name])?nameAlias(token):token).join(' ');
  return searchMatch(text,[...values,name]);
}
