import {verifyOcrSource} from './ocr-source.js';
export {normalizeExpenseSource,normalizeExpenseSourceReview,expenseSourceExpected} from '../../../site/assets/js/core/morning-expense-source.js';

export function expenseSourceSummary(row,{verified=!!row.source_verified_at}={}) {
  const expected=!!row.source_metadata||!!row.file_requested_at;
  return {sourceExpected:expected,sourceMetadata:row.source_metadata||null,sourceReview:row.source_review||null,
    sourceVerified:expected&&verified,sourceVerifiedAt:verified?row.source_verified_at:null,
    sourceException:!!row.source_waived_at,sourceExceptionReason:row.source_waived_reason||'',
    sourcePending:expected&&row.state!=='cancelled'&&!verified&&!row.source_waived_at};
}
export async function inspectExpenseSource(row,raw,environment,{verifySource=verifyOcrSource}={}) {
  let verified=false,code=row.file_requested_at?'legacy_unverified':'not_expected';
  if(row.source_metadata){
    code=raw.url?'unverified':'missing';
    if(raw.url){try{verified=await verifySource(raw,{sha256:row.source_metadata.sha256,size:row.source_metadata.size},environment)===true;code=verified?'matched':'mismatch';}
      catch{code='unavailable';}}
  }
  return {...expenseSourceSummary(row,{verified}),sourceCheck:code};
}
