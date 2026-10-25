/** @typedef {import('./credit-calculation-contracts.js').AccountRole} AccountRole */
/** @typedef {import('./credit-calculation-contracts.js').CardMapping} CardMapping */
/** @typedef {import('./credit-calculation-contracts.js').AccountTransition} AccountTransition */
/** @param {unknown} value @returns {AccountRole|''} */
function accountRole(value){return value==='ביתי'||value==='home'?'ביתי':value==='עסקי'||value==='business'?'עסקי':''}
/** @param {unknown} value @returns {string} */
function isoDay(value){const raw=String(value||'').slice(0,10),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);if(!match)return '';const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?raw:''}

/** @param {unknown} [value] @returns {AccountTransition[]} */
export function normalizeCreditCardAccountTransitions(value=[]){
  /** @type {AccountTransition[]} */ const rows=[];
  for(const raw of Array.isArray(value)?value:[]){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const effectiveDate=isoDay(raw.effectiveDate),fromAccount=accountRole(raw.fromAccount),toAccount=accountRole(raw.toAccount);
    if(!effectiveDate||!fromAccount||!toAccount||fromAccount===toAccount)continue;
    rows.push({effectiveDate,fromAccount,toAccount});
  }
  return rows.sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
}

/** @param {CardMapping} [mapping] @param {unknown} [defaultAccount] @param {unknown} [value] @returns {AccountRole} */
export function creditCardAccountForDateData(mapping={},defaultAccount='עסקי',value=''){
  const current=accountRole(mapping?.account)||accountRole(defaultAccount)||'עסקי',date=isoDay(value);
  if(!date)return current;
  const transitions=normalizeCreditCardAccountTransitions(mapping?.accountTransitions);
  let role=current,expected=current;
  for(let index=transitions.length-1;index>=0;index--){
    const transition=transitions[index];if(!transition)break;
    // A malformed or stale chain must not rewrite history. Only walk a transition
    // that leads to the account state we have already proved on its newer side.
    if(transition.toAccount!==expected)break;
    if(date>=transition.effectiveDate)break;
    role=transition.fromAccount;expected=transition.fromAccount;
  }
  return role;
}

/** @param {CardMapping} [mapping] @param {unknown} [nextAccount] @param {unknown} [effectiveDate] @returns {CardMapping & {account:AccountRole}} */
export function applyCreditCardAccountTransitionData(mapping={},nextAccount='עסקי',effectiveDate=''){
  const current=accountRole(mapping?.account)||'עסקי',next=accountRole(nextAccount)||'עסקי',date=isoDay(effectiveDate);
  if(current===next)return {...mapping,account:next};
  if(!date)throw new RangeError('credit_card_account_transition_date_required');
  const accountTransitions=normalizeCreditCardAccountTransitions(mapping?.accountTransitions);
  accountTransitions.push({effectiveDate:date,fromAccount:current,toAccount:next});
  return {...mapping,account:next,accountTransitions};
}
