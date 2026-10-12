/**
 * @typedef {'ccProvider'|'ccLabel'|'ccOwner'|'ccAccount'|'ccUsername'|'ccId'|'ccCard6'|'ccPassword'} CreditConnectionField
 * @typedef {{profileId:string,provider:string,label:string,ownerLabel:string,defaultAccount:string,username:string,id:string,card6Digits:string,password:string}} CreditConnectionInput
 */

// Keep credential strings intact, including leading zeros and password spaces.
// The local Bridge remains responsible for provider validation and encryption.
/** @param {string} profileId @param {(field:CreditConnectionField)=>string} readField @returns {CreditConnectionInput} */
export function readCreditConnectionInput(profileId,readField){
  return {
    profileId,provider:readField('ccProvider'),label:readField('ccLabel').trim(),
    ownerLabel:readField('ccOwner').trim(),defaultAccount:readField('ccAccount'),
    username:readField('ccUsername'),id:readField('ccId'),
    card6Digits:readField('ccCard6'),password:readField('ccPassword'),
  };
}
