import {expenseSourceUrl} from './ocr-source.js';

// Only a canonical provider URL may enter this bounded, read-only relay.
export async function readExpenseSource(raw,environment,{fetch:send=globalThis.fetch,timeoutMs=20000}={}) {
  const url=expenseSourceUrl(raw,environment),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let reader;
  const bounded=value=>new Promise((resolve,reject)=>{
    const abort=()=>reject(Error('expense_source_timeout'));
    if(controller.signal.aborted){abort();return;}
    controller.signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(value).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));
  });
  try{
    const response=await bounded(send(url,{redirect:'error',credentials:'omit',signal:controller.signal}));
    if(!response.ok||!response.body)throw Error('expense_source_unavailable');
    const max=20*1024*1024,length=response.headers.get('Content-Length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)<=0||Number(length)>max))throw Error('expense_source_size');
    reader=response.body.getReader();const chunks=[];let size=0;
    for(;;){const part=await bounded(reader.read());if(part.done)break;size+=part.value.byteLength;if(size>max)throw Error('expense_source_size');chunks.push(part.value);}
    if(!size||length!==null&&Number(length)!==size)throw Error('expense_source_size');
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer()),head=bytes.slice(0,8);
    const type=new TextDecoder().decode(head).startsWith('%PDF-')?'application/pdf':head[0]===255&&head[1]===216&&head[2]===255?'image/jpeg':
      [137,80,78,71,13,10,26,10].every((n,i)=>head[i]===n)?'image/png':'';
    if(!type)throw Error('expense_source_type');
    return new Blob([bytes],{type});
  }finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
