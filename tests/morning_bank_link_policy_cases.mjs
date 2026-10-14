export function morningBankLinkPolicyCases(build){
  const outputs=[];
  for(const kind of ['standalone','debt','bank'])for(const type of [305,320,400])for(const name of ['', 'Original client'])for(const blocked of [false,true])for(const busy of [false,true])for(const variant of ['valid','linked','missing','debit','currency','pending','checks','bad-date']){
    let source={kind},payments=[{type:4,date:'2026-10-01',price:17,currency:'ILS'}];const messages=[];
    const values={morningClientName:name,morningAmount:'17',morningDocumentDate:'2026-10-01',morningDescription:'Original description'};
    const fields=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value,closest(){return this}}]));
    const radios=new Map([305,320,400].map(value=>[value,{checked:value===type,disabled:false,closest:()=>({classList:{toggle(){}}})}]));
    const query=selector=>radios.get(Number(selector.match(/value="(\d+)"/)?.[1]))||null;
    const transaction={archiveId:71,amount:42,date:'2026-10-14',currency:'ILS',status:'processed',partyName:'Bank client',description:'Bank description',bankReference:'REF-71'};
    if(variant==='linked')transaction.documentLinks=[{documentId:'verified'}];if(variant==='debit')transaction.amount=-42;if(variant==='currency')transaction.currency='USD';if(variant==='pending')transaction.status='pending';
    if(variant==='bad-date')transaction.date='invalid-date';
    if(variant==='checks')transaction.checkDetails={kind:'deposit',checkCount:2,checkItems:[1,2].map(index=>({bankNumber:'12',branchNumber:'34',accountNumber:'1234567',checkNumber:String(index),amount:21}))};
    const root={querySelector:query,querySelectorAll:()=>[],getElementById:()=>null},environment={
      source:{read:()=>source,set:next=>{source=next}},fields:{get:id=>fields[id]||null,query,date:value=>{fields.morningDocumentDate.value=value}},
      payments:{read:()=>structuredClone(payments),replace:rows=>{payments=structuredClone(rows)},sync(){}},document:{type:()=>[...radios].find(([,radio])=>radio.checked)?.[0]||0,sync(){}},
      catalog:{read:()=>variant==='missing'?[]:[transaction],ensure:async()=>true},session:{generation:()=>1,isActive:()=>true},presentation:{panel:()=>'',exists:()=>true,query:()=>'',render:()=>0,select(){},blur(){},toast:message=>messages.push(message),error:error=>{throw error}},
      root,currentField:id=>fields[id]||null,selectedType:()=>[...radios].find(([,radio])=>radio.checked)?.[0]||0,
    };
    // Native radio groups uncheck their siblings when one is selected.
    for(const [value,radio] of radios){let checked=radio.checked;Object.defineProperty(radio,'checked',{get:()=>checked,set:next=>{if(next)for(const [other,sibling] of radios)if(other!==value)sibling.checked=false;checked=next}})}
    const owner=build(environment);owner.reset({kind});const linked=owner.link(71,{blocked,busy});
    const snapshot=()=>({source:structuredClone(source),fields:Object.fromEntries(Object.entries(fields).map(([id,field])=>[id,field.value])),payments:structuredClone(payments),type:environment.selectedType(),invoiceDisabled:radios.get(305).disabled});
    const after=snapshot(),cleared=owner.clear({blocked,busy});outputs.push({linked,after,cleared,restored:snapshot(),messages});
  }
  return outputs;
}
