// Preserve the immutable historical policy/hash while reconstructing only the
// separately tested retained-receipt authority boundary.
export function restoreCreditPublicationAuthority(source) {
  return source
    .replace(/\r\n/g, '\n')
    .replace(' @param {PublicationAssertion} assertRetained', '')
    .replace(
      'async function commit(mutator,message,lease,assertCurrent,assertRetained)',
      'async function commit(mutator,message,lease,assertCurrent)'
    )
    .replace(
      "    if(typeof assertRetained!=='function')throw new TypeError('credit_publication_retained_authority_required');\n",
      ''
    )
    .replace(
      "['FINANCE_OPERATION_SCOPE_CHANGED','CREDIT_CONNECTION_SCOPE_CHANGED','BRIDGE_PAIRING_SCOPE_CHANGED'].includes(String(error.code))",
      "error.code==='FINANCE_OPERATION_SCOPE_CHANGED'"
    )
    .replace(
      ' @param {PublicationAssertion} assertCurrent @returns {Promise<PublicationResult>} */\n  async function follow(receipt,message,assertCurrent)',
      ' @returns {Promise<PublicationResult>} */\n  async function follow(receipt,message)'
    )
    .replaceAll('receipt.assertCurrent();assertCurrent();', 'receipt.assertCurrent();')
    .replace('assertCurrent();assertRetained();', 'assertCurrent();')
    .replace(
      'const receipt={revision,assertCurrent:assertRetained,',
      'const receipt={revision,assertCurrent,'
    )
    .replace('follow(receipt,message,assertCurrent)', 'follow(receipt,message)')
    .replace(
      "follow(receipt,'נתוני האשראי נטענו מחדש מהענן',assertCurrent)",
      "follow(receipt,'נתוני האשראי נטענו מחדש מהענן')"
    );
}
