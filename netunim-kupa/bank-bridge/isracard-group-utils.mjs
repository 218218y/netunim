function accountNumber(value){return String(value??'').trim().slice(0,80)}


function brandVersions(value=[]){
  return (Array.isArray(value)?value:[]).map(row=>({brand:String(row?.brand||'').trim().slice(0,80),version:String(row?.version||'').trim().slice(0,40)})).filter(row=>row.brand&&row.version).slice(0,12);
}
function chromiumProduct(userAgent=''){
  return /\bEdg\//i.test(String(userAgent||''))?'edge':/\bChrome\//i.test(String(userAgent||''))?'chrome':'';
}
function brandedClientHints(product,brands=[]){
  const names=(Array.isArray(brands)?brands:[]).map(row=>String(row?.brand||''));
  return product==='edge'?names.some(name=>/Microsoft Edge/i.test(name)):product==='chrome'?names.some(name=>/Google Chrome/i.test(name)):false;
}
function majorVersion(userAgent=''){
  const match=String(userAgent||'').match(/\b(?:Chrome|Edg)\/(\d+)/i),value=Number(match?.[1]);
  return Number.isFinite(value)?Math.trunc(value):0;
}

/**
 * Keep the installed Chrome/Edge network identity coherent when masking only the
 * classic HeadlessChrome UA token. Puppeteer maps setUserAgent() to CDP's
 * Network.setUserAgentOverride; Client Hints are only preserved when the native
 * userAgentMetadata is supplied as well. Never synthesize brands or versions.
 */
export async function preserveInstalledChromiumIdentity(page){
  const native=await page.evaluate(async()=>{
    const data=navigator.userAgentData;let high={};
    if(data?.getHighEntropyValues){
      try{high=await data.getHighEntropyValues(['architecture','bitness','model','platformVersion','uaFullVersion','fullVersionList','wow64'])}catch{}
    }
    return {userAgent:String(navigator.userAgent||''),navigatorPlatform:String(navigator.platform||''),userAgentData:data?{brands:Array.isArray(data.brands)?data.brands:[],mobile:!!data.mobile,platform:String(data.platform||''),...high}:null};
  });
  const nativeUserAgent=String(native?.userAgent||''),userAgent=nativeUserAgent.replace('HeadlessChrome/','Chrome/'),product=chromiumProduct(userAgent),uaData=native?.userAgentData;
  if(!product||!uaData)return {ok:false,userAgent,product,clientHintsState:'missing',browserMajorVersion:majorVersion(userAgent)};
  const brands=brandVersions(uaData.brands),fullVersionList=brandVersions(uaData.fullVersionList),branded=brandedClientHints(product,[...brands,...fullVersionList]);
  if(!brands.length||!branded)return {ok:false,userAgent,product,clientHintsState:brands.length?'unbranded':'missing',browserMajorVersion:majorVersion(userAgent)};
  const userAgentMetadata={brands,mobile:!!uaData.mobile,platform:String(uaData.platform||'')};
  if(fullVersionList.length)userAgentMetadata.fullVersionList=fullVersionList;
  for(const key of ['architecture','bitness','model','platformVersion']){const value=String(uaData?.[key]??'').trim();if(value)userAgentMetadata[key]=value}
  if(typeof uaData?.wow64==='boolean')userAgentMetadata.wow64=uaData.wow64;
  const fullVersion=String(uaData?.uaFullVersion||'').trim();if(fullVersion)userAgentMetadata.fullVersion=fullVersion;
  await page.setUserAgent({userAgent,userAgentMetadata,platform:String(native?.navigatorPlatform||'')||undefined});
  return {ok:true,userAgent,product,clientHintsState:'preserved',browserMajorVersion:majorVersion(userAgent)};
}

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
