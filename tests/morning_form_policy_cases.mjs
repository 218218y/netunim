export function morningFormPolicyCases(render){
  const outputs=[];
  const prefills=[{}, {customerName:'Exact customer',amount:42.5,date:'2026-10-14',description:'Exact description'},
    {customerName:'<script>unsafe()</script>',amount:0,description:'<b>unsafe</b>',remarks:'</textarea><img src=x>',email:'" onfocus="unsafe()'},
    {customerName:0,amount:'99.235',date:'2026-09-01',orderNumber:123,phone:456,taxId:'012345678',remarks:'Exact note'},
    {amount:-12.5,date:'',description:'',customerName:'Default description',amountExtra:100}];
  for(const kind of ['standalone','debt','bank'])for(const type of [305,320,400])for(const prefill of prefills)outputs.push(render.form(prefill,type,kind));
  for(const progress of [{paymentApplied:0,invoiceApplied:0},{paymentApplied:30,invoiceApplied:0},{paymentApplied:0,invoiceApplied:20},{paymentApplied:30,invoiceApplied:20}])outputs.push(render.debt(progress));
  const snapshot=(amount=100,paymentApplied=0,invoiceApplied=0)=>({amount,paymentApplied,invoiceApplied,paymentComplete:paymentApplied>=amount,invoiceComplete:invoiceApplied>=amount});
  for(const type of [305,320,400])for(const applyPayment of [false,true])for(const applyInvoice of [false,true])for(const financialSnapshot of [undefined,snapshot()])for(const current of [snapshot(),snapshot(80,20,10)])for(const resolution of [undefined,{financialSnapshot:current,applyPayment:true,applyInvoice:false,confirmedAt:''},{financialSnapshot:snapshot(999),applyPayment:false,applyInvoice:true,confirmedAt:''}]){
    const context={operationId:'11111111-1111-4111-8111-111111111111',debtId:'exact-debt',type,amount:30,applyPayment,applyInvoice,...(financialSnapshot?{financialSnapshot}:{}),...(resolution?{resolution}:{})};
    outputs.push(render.decision(context,current));
  }
  outputs.push(render.foot(),render.button({id:'<unsafe-id>"'}));
  for(const state of [undefined,'reserved','created_unverified','created','pending','failed'])for(const verified_at of [undefined,'2026-10-14T00:00:00Z'])outputs.push(render.operation({state,verified_at,document_id:'<unsafe-document>"',document_number:'<unsafe-number>',allocation_number:'<unsafe-allocation>'}));
  return outputs;
}
