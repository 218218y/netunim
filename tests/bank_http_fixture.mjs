import http from 'node:http';
import {configurationHandler} from './bank_configuration_fixture.mjs';

export async function httpFixture(t,ports={}){
  const api=configurationHandler(ports),running=new Set(),server=http.createServer((req,res)=>{
    const task=api.handler(req,res,'fixture-token').catch(error=>{res.writeHead(500);res.end(JSON.stringify({code:error.code||'BRIDGE_ERROR',message:error.message}))}).finally(()=>running.delete(task));running.add(task);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(target,{method='GET',token='fixture-token',origin='https://fixture.example',body='',chunks,headers={}}={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+target,{method,agent:false,headers:{Authorization:'Bearer '+token,Origin:origin,
      ...(chunks?{'Transfer-Encoding':'chunked'}:{'Content-Length':Buffer.byteLength(body)}),...headers}},res=>{
      const collected=[];res.on('error',reject);res.on('data',chunk=>collected.push(chunk));res.on('end',()=>{const bytes=Buffer.concat(collected);let data;try{data=JSON.parse(bytes)}catch{}resolve({status:res.statusCode,headers:res.headers,bytes,data})});
    });
    req.on('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('fixture HTTP deadline')));
    for(const chunk of chunks||[body])req.write(chunk);req.end();
  });
  return {api,server,request,base,drain:async()=>{while(running.size)await Promise.allSettled([...running])}};
}
