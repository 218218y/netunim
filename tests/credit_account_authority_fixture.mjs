import {restoreCreditCooldown} from './credit_cooldown_policy_fixture.mjs';
// Project only the separately tested account-authority change out of historical
// policy comparisons. Keep the immutable baseline hashes and every other byte.
export function restoreCreditPendingStatus(source){
  return source.replace(
    /(['"]network_error['"])(,\s*['"]missing['"])(\]\.includes\(\s*String\(account\.pendingStatus\)\s*\))/, '$1$3');
}

export function restoreCreditAccountFeed(source,{orders=false}={}){
  source=restoreCreditCooldown(restoreCreditPendingStatus(source));
  source=source.replace(`const base=normalizeCreditSync(current),mappings={...base.cardMappings},
    byId=new Map(base.profiles.map(profile=>[profile.profileId,profile]));
  // Supported older responses can omit metadata without erasing a known issuer
  // or moving its default business routing. Supplied invalid metadata is rejected
  // by the current-response boundary before this historical-feed normalizer.
  const rawSuccesses=(Array.isArray(payload.profiles)?payload.profiles:[]).map(profile=>{
    const previous=byId.get(profile.profileId);
    return normalizeCreditProfile({...profile,
      provider:profile.provider===undefined?previous?.provider:profile.provider,
      defaultAccount:profile.defaultAccount===undefined?previous?.defaultAccount:profile.defaultAccount,
    });
  }).filter(profile=>profile.profileId),successes=[];`,
  'const base=normalizeCreditSync(current),mappings={...base.cardMappings},byId=new Map(base.profiles.map(profile=>[profile.profileId,profile])),rawSuccesses=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(profile=>profile.profileId),successes=[];');
  if(orders){
    const start=source.indexOf('export function normalizeCreditAccount('),
      end=source.indexOf('\nexport function normalizeCreditProfile',start);
    if(start>=0&&end>start)source=source.slice(0,start)+
      source.slice(start,end).replace(/,\n\s*/g,',')+source.slice(end);
  }
  return source;
}

export function restoreCreditProfileAuthority(source){
  return source.replace(`  try{assertCreditProfileTransactions(profile)}catch(cause){
    throw Object.assign(new Error('Credit profile identity is invalid',{cause}),{
      code:'CREDIT_PROVIDER_SCHEMA_ERROR',stage:'Profile',retryable:false,
    });
  }
`,'');
}
