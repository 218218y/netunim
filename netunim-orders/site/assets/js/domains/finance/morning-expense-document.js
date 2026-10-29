export async function openExpenseDocument({id,request,check,environment,report,open=globalThis.open.bind(globalThis)}){
  const popup=open('about:blank','_blank');
  if(!popup){report('יש לאפשר פתיחת חלון למסמך ולנסות שוב.');return false;}
  popup.opener=null;
  try{
    popup.document.body.textContent='טוען את מסמך המקור ממורנינג…';
    const data=await request('source_link',{id,expectedEnvironment:environment},check);check();
    const url=new URL(data.url),origins=environment==='production'?['https://www.greeninvoice.co.il','https://api.greeninvoice.co.il']:['https://sandbox.d.greeninvoice.co.il'];
    if(!origins.includes(url.origin)||url.pathname!=='/api/v1/expenses/download'||url.username||url.password||url.hash)throw Error('קישור המקור אינו תקין.');
    popup.location.replace(url.href);return true;
  }catch(error){popup.close();try{check();report(error.message);}catch{/* old account */}return false;}
}
