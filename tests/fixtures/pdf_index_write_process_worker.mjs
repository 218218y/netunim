import path from 'node:path';
import {createPdfIndexReader} from '../../netunim-orders/document-bridge/pdf-index-reader.mjs';
import {createPdfIndexFilePlatform} from '../../netunim-orders/document-bridge/pdf-index-file-platform.mjs';
import {createPdfIndexWriter} from '../../netunim-orders/document-bridge/pdf-index-writer.mjs';
import {createPdfIndexWritePlatform} from '../../netunim-orders/document-bridge/pdf-index-write-platform.mjs';
import {createFileLockOwner} from '../../netunim-orders/document-bridge/file-lock-owner.mjs';
import {createFileLockPlatform} from '../../netunim-orders/document-bridge/file-lock-platform.mjs';
const [root,label,mode]=process.argv.slice(2),paths={snapshotPath:path.join(root,'index.json'),journalPath:path.join(root,'index.jsonl')};
const send=value=>new Promise(resolve=>process.send(value,resolve));
const released=new Promise(resolve=>process.once('message',message=>{if(message==='release')resolve()}));
const locks=createFileLockOwner({...createFileLockPlatform({root}),clock:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
const reader=createPdfIndexReader({files:createPdfIndexFilePlatform(paths),normalizeEntry:value=>value});
const files=createPdfIndexWritePlatform(paths);
if(mode==='crash')files.clearJournal=async()=>{await send({kind:'snapshot-committed'});await new Promise(()=>{})};
const writer=createPdfIndexWriter({reader,files,lock:{run:work=>locks.run(path.join(root,'lock'),async()=>{await send({kind:'locked'});await released;return work()})},serializeEntry:value=>value,publish:()=>{},now:Date.now});
try{
  await send({kind:'ready'});
  if(mode==='crash')await writer.compact();else{await writer.append([{op:'upsert',entry:{fullPath:`C:\\synthetic\\${label}.pdf`,text:label}}]);if(mode==='compact')await writer.compact()}
  await send({kind:'done'});
}catch(error){await send({kind:'failed',code:error.code||'ERROR'});process.exitCode=1}
if(process.connected)process.disconnect();
