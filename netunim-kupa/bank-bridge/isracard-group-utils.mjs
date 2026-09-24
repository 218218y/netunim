function accountNumber(value){return String(value??'').trim().slice(0,80)}

function excludedAccountSet(values=[]){
  return new Set((Array.isArray(values)?values:[]).map(accountNumber).filter(Boolean));
}

export function filterExcludedGroupCards(cards=[],excludedAccountNumbers=[],onExcluded=()=>{}){
  const excluded=excludedAccountSet(excludedAccountNumbers);
  if(!excluded.size)return Array.isArray(cards)?cards:[];
  return (Array.isArray(cards)?cards:[]).filter(card=>{
    const suffix=accountNumber(card?.cardSuffix);
    if(!excluded.has(suffix))return true;
    try{onExcluded(suffix)}catch{}
    return false;
  });
}

export function isApprovedTransactionSettled(approved={},vouchers=[]){
  return (Array.isArray(vouchers)?vouchers:[]).some(voucher=>
    voucher?.purchaseDate===approved?.purchaseDate&&
    voucher?.originalAmount===approved?.originalAmount&&
    String(voucher?.originalCurrencyIso||'')===String(approved?.currencyIso||'')&&
    String(voucher?.businessName||'').trim()===String(approved?.businessName||'').trim()
  );
}

export function unsettledApprovedTransactions(approvedRows=[],voucherRows=[],immediateGroups=[]){
  const vouchers=[
    ...(Array.isArray(voucherRows)?voucherRows:[]),
    ...(Array.isArray(immediateGroups)?immediateGroups:[]).flatMap(group=>Array.isArray(group?.immediateVouchersCurrencyDate)?group.immediateVouchersCurrencyDate:[]),
  ];
  return (Array.isArray(approvedRows)?approvedRows:[]).filter(approved=>!isApprovedTransactionSettled(approved,vouchers));
}
