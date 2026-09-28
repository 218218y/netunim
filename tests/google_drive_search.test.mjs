import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGoogleDriveQuery,createDomainsGoogleDriveSearch,isAndroidDocumentSearch,safeGoogleDriveViewUrl} from '../netunim-orders/site/assets/js/domains/documents/google-drive.js';
import {createDomainsDocumentSearch} from '../netunim-orders/site/assets/js/domains/documents/search-source.js';

test('Google Drive search query separates filename and indexed-content semantics',()=>{
  assert.equal(buildGoogleDriveQuery('budget 2026','everything'),"trashed = false and name contains 'budget' and name contains '2026'");
  const content=buildGoogleDriveQuery('invoice paid','content');
  assert.match(content,/trashed = false/);
  assert.match(content,/mimeType != 'application\/vnd\.google-apps\.folder'/);
  assert.match(content,/fullText contains 'invoice'/);
  assert.match(content,/fullText contains 'paid'/);
  assert.equal(buildGoogleDriveQuery("O'Brien\\archive",'everything'),"trashed = false and name contains 'O\\'Brien\\\\archive'");
});

test('document search uses Drive on Android and prefers local Everything on Windows',()=>{
  const local={provider:'everything',getToken:()=> 'local-token'},drive={provider:'google-drive',getToken:()=> 'drive-managed'};
  assert.equal(isAndroidDocumentSearch('Mozilla/5.0 (Linux; Android 15; Pixel 9)'),true);
  assert.equal(isAndroidDocumentSearch('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),false);
  const android=createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Linux; Android 15)'});
  const windows=createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
  assert.equal(android.provider,'google-drive');
  assert.equal(windows.provider,'everything');
  assert.equal(windows.getToken(),'local-token');
});

test('Windows document search falls back to Drive and namespaces result ownership',async()=>{
  const local={
    provider:'everything',getToken:()=> 'local-token',
    search:async()=>{const error=new Error('Everything unavailable');error.code='EVERYTHING_UNAVAILABLE';throw error},
  };
  const drive={provider:'google-drive',getToken:()=> 'drive-managed',search:async()=>({ok:true,results:[{id:'g1',name:'Cloud.pdf'}]}),preview:async id=>({ok:true,kind:'binary',id})};
  const source=createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
  const result=await source.search('cloud',{mode:'everything'});
  assert.equal(source.provider,'google-drive');
  assert.match(source.providerNotice,/Google Drive/);
  assert.equal(result.results[0].id,'drive:g1');
  assert.equal(source.providerFor('drive:g1'),'google-drive');
  const preview=await source.preview('drive:g1');
  assert.equal(preview.id,'g1');
});

test('Drive view links accept only HTTPS Google-owned destinations',()=>{
  assert.equal(safeGoogleDriveViewUrl('https://drive.google.com/file/d/a/view'),'https://drive.google.com/file/d/a/view');
  assert.equal(safeGoogleDriveViewUrl('https://docs.google.com/document/d/b/edit'),'https://docs.google.com/document/d/b/edit');
  assert.equal(safeGoogleDriveViewUrl('https://script.google.com/d/c/edit'),'https://script.google.com/d/c/edit');
  assert.equal(safeGoogleDriveViewUrl('http://drive.google.com/file/d/a/view'),'');
  assert.equal(safeGoogleDriveViewUrl('https://drive.google.com.evil.example/file/d/a/view'),'');
});

test('Google Drive source refreshes token, paginates and downloads a PDF preview',async()=>{
  const assigned=[],apiCalls=[],backendCalls=[];
  const locationRef={href:'https://example.test/orders?drive_oauth=connected',assign:url=>assigned.push(url)};
  const historyRef={state:null,replaced:'',replaceState(_state,_title,url){this.replaced=url}};
  const supaFetch=async(_path,options)=>{
    const body=JSON.parse(options.body);backendCalls.push(body);
    if(body.action==='token')return {ok:true,status:200,json:async()=>({access_token:'access-123',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.readonly'})};
    if(body.action==='start')return {ok:true,status:200,json:async()=>({authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?state=abc'})};
    throw new Error(`unexpected backend action ${body.action}`);
  };
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(String(url));apiCalls.push({url:parsed,options});assert.equal(options.headers.Authorization,'Bearer access-123');
    if(parsed.pathname.endsWith('/files')){
      const pageToken=parsed.searchParams.get('pageToken');
      if(!pageToken)return {ok:true,status:200,text:async()=>JSON.stringify({files:[{id:'a',name:'Invoice.pdf',mimeType:'application/pdf',modifiedTime:'2026-09-27T10:00:00Z',size:'123',fileExtension:'pdf',webViewLink:'https://drive.google.com/file/d/a/view',resourceKey:'rk-a',capabilities:{canDownload:true}}],nextPageToken:'next'})};
      return {ok:true,status:200,text:async()=>JSON.stringify({files:[{id:'b',name:'Paid.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',modifiedTime:'2026-09-27T09:00:00Z',size:'456',fileExtension:'docx',webViewLink:'https://docs.google.com/document/d/b/edit',capabilities:{canDownload:true}}]})};
    }
    if(parsed.pathname.endsWith('/files/a')&&parsed.searchParams.get('alt')==='media')return {ok:true,status:200,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new TextEncoder().encode('%PDF-preview').buffer};
    throw new Error(`unexpected Drive URL ${url}`);
  };
  try{
    const drive=createDomainsGoogleDriveSearch({supaFetch,locationRef,historyRef});
    assert.equal(historyRef.replaced,'/orders');
    const data=await drive.search('invoice paid',{mode:'content',limit:2});
    assert.deepEqual(data.results.map(row=>row.id),['a','b']);
    assert.equal(apiCalls.filter(call=>call.url.pathname.endsWith('/files')).length,2);
    const first=apiCalls[0].url;
    assert.equal(first.searchParams.get('corpora'),'user');
    assert.equal(first.searchParams.get('includeItemsFromAllDrives'),'true');
    assert.match(first.searchParams.get('fields'),/capabilities\(canDownload\)/);
    assert.match(first.searchParams.get('q'),/fullText contains 'invoice'/);
    assert.equal(apiCalls[1].url.searchParams.get('pageToken'),'next');
    const preview=await drive.preview('a');
    assert.equal(preview.kind,'binary');
    assert.equal(preview.mime,'application/pdf');
    const blob=await drive.previewFile('a');
    assert.equal(blob.type,'application/pdf');
    assert.equal(await blob.text(),'%PDF-preview');
    const mediaCall=apiCalls.at(-1);
    assert.equal(mediaCall.url.searchParams.get('alt'),'media');
    assert.equal(mediaCall.options.headers['X-Goog-Drive-Resource-Keys'],'a/rk-a');
    await drive.openDocument('a');
    assert.equal(assigned.at(-1),'https://drive.google.com/file/d/a/view');
    await drive.beginConnect({returnUrl:'https://example.test/orders'});
    assert.match(assigned.at(-1),/^https:\/\/accounts\.google\.com\//);
    assert.deepEqual(backendCalls.map(row=>row.action),['token','start']);
  }finally{globalThis.fetch=previousFetch}
});

test('native Google Docs are exported to PDF for the in-site preview',async()=>{
  const supaFetch=async()=>({ok:true,status:200,json:async()=>({access_token:'access-123',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.readonly'})});
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(String(url));calls.push(parsed);
    if(parsed.pathname.endsWith('/files/doc-1')&&!parsed.pathname.endsWith('/export'))return {ok:true,status:200,text:async()=>JSON.stringify({id:'doc-1',name:'Native Doc',mimeType:'application/vnd.google-apps.document',webViewLink:'https://docs.google.com/document/d/doc-1/edit',capabilities:{canDownload:true}})};
    if(parsed.pathname.endsWith('/files/doc-1/export'))return {ok:true,status:200,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer};
    throw new Error(`unexpected Drive URL ${url}`);
  };
  try{
    const drive=createDomainsGoogleDriveSearch({supaFetch,locationRef:{href:'https://example.test/orders'},historyRef:{}});
    const preview=await drive.preview('doc-1');
    assert.equal(preview.kind,'binary');
    assert.equal(preview.mime,'application/pdf');
    const blob=await drive.previewFile('doc-1');
    assert.equal(blob.type,'application/pdf');
    const exportCall=calls.at(-1);
    assert.match(exportCall.pathname,/\/files\/doc-1\/export$/);
    assert.equal(exportCall.searchParams.get('mimeType'),'application/pdf');
  }finally{globalThis.fetch=previousFetch}
});

test('Windows failover does not hide ordinary local search errors',async()=>{
  let driveCalled=false;
  const local={provider:'everything',getToken:()=> 'local-token',search:async()=>{const error=new Error('Query is invalid');error.code='QUERY_INVALID';throw error}};
  const drive={provider:'google-drive',getToken:()=> 'drive-managed',search:async()=>{driveCalled=true;return {ok:true,results:[]}}};
  const source=createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
  await assert.rejects(()=>source.search('x',{mode:'everything'}),error=>error?.code==='QUERY_INVALID');
  assert.equal(driveCalled,false);
  assert.equal(source.provider,'everything');
});

test('Drive preview respects canDownload=false and does not fetch file content',async()=>{
  const supaFetch=async()=>({ok:true,status:200,json:async()=>({access_token:'access-123',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.readonly'})});
  const previousFetch=globalThis.fetch;let contentFetches=0;
  globalThis.fetch=async url=>{
    const parsed=new URL(String(url));
    if(parsed.pathname.endsWith('/files'))return {ok:true,status:200,text:async()=>JSON.stringify({files:[{id:'locked',name:'Locked.pdf',mimeType:'application/pdf',fileExtension:'pdf',size:'10',webViewLink:'https://drive.google.com/file/d/locked/view',capabilities:{canDownload:false}}]})};
    contentFetches+=1;throw new Error(`unexpected content request ${url}`);
  };
  try{
    const drive=createDomainsGoogleDriveSearch({supaFetch,locationRef:{href:'https://example.test/orders'},historyRef:{}});
    const data=await drive.search('locked',{mode:'everything',limit:1});
    const preview=await drive.preview(data.results[0].id);
    assert.equal(preview.kind,'cloud');
    assert.match(preview.previewReason,/חסם הורדה/);
    assert.equal(contentFetches,0);
  }finally{globalThis.fetch=previousFetch}
});

