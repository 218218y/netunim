import {extractInteractivePdfText} from './pdf_form_index.mjs';
import {assertBridgeNodeVersion} from './lib.mjs';

if(process.platform==='win32')assertBridgeNodeVersion(process.versions.node);

let input='';
for await(const chunk of process.stdin){
  input+=chunk;
  if(input.length>64*1024)throw new Error('PDF worker request too large');
}
try{
  const request=JSON.parse(input);
  if(typeof request.fullPath!=='string'||!request.fullPath)throw new Error('Missing PDF path');
  const result=await extractInteractivePdfText(request.fullPath,{includePageText:request.includePageText!==false});
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
}catch(error){
  process.stdout.write(JSON.stringify({ok:false,error:String(error?.message||error)})+'\n');
  process.exitCode=1;
}
