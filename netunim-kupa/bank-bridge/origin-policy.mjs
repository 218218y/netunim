// @ts-check
/** @typedef {{version:1,mode:'legacy-reflect'|'allowlist',allowedOrigins:string[]}} OriginConfiguration */
/** @typedef {{mode:OriginConfiguration['mode'],allows:(origin:unknown)=>boolean}} OriginPolicy */

/** @param {unknown} value @returns {string} */
function exactOrigin(value){
  if(typeof value!=='string')throw new TypeError('BANK_ORIGIN_INVALID');
  let parsed;
  try{parsed=new URL(value)}catch{throw new TypeError('BANK_ORIGIN_INVALID')}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.hostname.includes('*')||parsed.origin!==value){
    throw new TypeError('BANK_ORIGIN_INVALID');
  }
  return value;
}

/** @param {unknown} value @returns {OriginConfiguration} */
export function decodeBankOriginConfiguration(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('BANK_ORIGIN_CONFIG_INVALID');
  const config=/** @type {Record<string,unknown>} */(value);
  if(config.version!==1||(config.mode!=='legacy-reflect'&&config.mode!=='allowlist')){
    throw new TypeError('BANK_ORIGIN_CONFIG_INVALID');
  }
  const raw=config.allowedOrigins===undefined?[]:config.allowedOrigins;
  if(!Array.isArray(raw)||raw.length>64)throw new TypeError('BANK_ORIGIN_CONFIG_INVALID');
  return {version:1,mode:config.mode,allowedOrigins:[...new Set(raw.map(exactOrigin))]};
}

/** @param {URL} origin */
function defaultOriginAllowed(origin){
  if(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))return true;
  if(origin.protocol!=='https:'||origin.port)return false;
  return ['bargig-furniture.com','bargig-orders.pages.dev','bargig-kupa.pages.dev']
    .some(host=>origin.hostname===host||origin.hostname.endsWith('.'+host));
}

/**
 * Capture an immutable policy once at startup. Missing configuration retains
 * the deployed policy; malformed explicit configuration never restores it.
 * @param {unknown} [configuration]
 * @returns {OriginPolicy}
 */
export function createBankOriginPolicy(configuration){
  /** @type {Pick<OriginConfiguration,'mode'|'allowedOrigins'>} */
  const config=configuration===undefined?{mode:'legacy-reflect',allowedOrigins:[]}
    :decodeBankOriginConfiguration(configuration);
  const custom=new Set(config.allowedOrigins);
  /** @param {unknown} value */
  function allows(value){
    if(value===undefined||value==='')return true; // Native loopback clients.
    if(typeof value!=='string')return false;
    if(config.mode==='legacy-reflect')return true;
    let origin;
    try{origin=new URL(exactOrigin(value))}catch{return false}
    return custom.has(value)||defaultOriginAllowed(origin);
  }
  return Object.freeze({mode:config.mode,allows});
}
