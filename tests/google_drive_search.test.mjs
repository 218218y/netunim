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

test('document search source selects Google Drive only for Android and keeps Everything bridge on Windows',()=>{
  const local={provider:'everything'},drive={provider:'google-drive'};
  assert.equal(isAndroidDocumentSearch('Mozilla/5.0 (Linux; Android 15; Pixel 9)'),true);
  assert.equal(isAndroidDocumentSearch('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),false);
  assert.equal(createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Linux; Android 15)'}),drive);
  assert.equal(createDomainsDocumentSearch({localBridge:local,googleDrive:drive,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}),local);
});

test('Drive view links accept only HTTPS Google-owned destinations',()=>{
  assert.equal(safeGoogleDriveViewUrl('https://drive.google.com/file/d/a/view'),'https://drive.google.com/file/d/a/view');
  assert.equal(safeGoogleDriveViewUrl('https://docs.google.com/document/d/b/edit'),'https://docs.google.com/document/d/b/edit');
  assert.equal(safeGoogleDriveViewUrl('https://script.google.com/d/c/edit'),'https://script.google.com/d/c/edit');
  assert.equal(safeGoogleDriveViewUrl('http://drive.google.com/file/d/a/view'),'');
  assert.equal(safeGoogleDriveViewUrl('https://drive.google.com.evil.example/file/d/a/view'),'');
});

test('Google Drive source refreshes token, paginates results and exposes an official view link for opening',async()=>{
  const assigned=[],apiCalls=[],backendCalls=[];
  const locationRef={href:'https://example.test/orders?drive_oauth=connected',assign:url=>assigned.push(url)};
  const historyRef={state:null,replaced:'',replaceState(_state,_title,url){this.replaced=url}};
  const supaFetch=async(_path,options)=>{
    const body=JSON.parse(options.body);backendCalls.push(body);
    if(body.action==='token')return {ok:true,status:200,json:async()=>({access_token:'access-123',expires_in:3600})};
    if(body.action==='start')return {ok:true,status:200,json:async()=>({authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?state=abc'})};
    throw new Error(`unexpected backend action ${body.action}`);
  };
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(String(url));apiCalls.push({url:parsed,options});assert.equal(options.headers.Authorization,'Bearer access-123');
    if(!parsed.pathname.endsWith('/files'))throw new Error(`unexpected Drive URL ${url}`);
    const pageToken=parsed.searchParams.get('pageToken');
    if(!pageToken){
      return {ok:true,status:200,text:async()=>JSON.stringify({
        files:[{id:'a',name:'Invoice.pdf',mimeType:'application/pdf',modifiedTime:'2026-09-27T10:00:00Z',size:'123',fileExtension:'pdf',webViewLink:'https://drive.google.com/file/d/a/view',resourceKey:'rk-a'}],
        nextPageToken:'next',
      })};
    }
    return {ok:true,status:200,text:async()=>JSON.stringify({
      files:[{id:'b',name:'Paid.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',modifiedTime:'2026-09-27T09:00:00Z',size:'456',fileExtension:'docx',webViewLink:'https://docs.google.com/document/d/b/edit'}],
    })};
  };
  try{
    const drive=createDomainsGoogleDriveSearch({supaFetch,locationRef,historyRef});
    assert.equal(historyRef.replaced,'/orders');
    const data=await drive.search('invoice paid',{mode:'content',limit:2});
    assert.deepEqual(data.results.map(row=>row.id),['a','b']);
    assert.equal(apiCalls.length,2);
    const first=apiCalls[0].url;
    assert.equal(first.searchParams.get('corpora'),'user');
    assert.equal(first.searchParams.get('includeItemsFromAllDrives'),'true');
    assert.match(first.searchParams.get('fields'),/webViewLink/);
    assert.match(first.searchParams.get('q'),/fullText contains 'invoice'/);
    assert.match(first.searchParams.get('q'),/mimeType != 'application\/vnd\.google-apps\.folder'/);
    assert.equal(apiCalls[1].url.searchParams.get('pageToken'),'next');
    const preview=await drive.preview('a');
    assert.equal(preview.kind,'cloud');
    assert.equal(preview.source,'google-drive');
    assert.equal(preview.webViewLink,'https://drive.google.com/file/d/a/view');
    await drive.openDocument('a');
    assert.equal(assigned.at(-1),'https://drive.google.com/file/d/a/view');
    await drive.beginConnect({returnUrl:'https://example.test/orders'});
    assert.match(assigned.at(-1),/^https:\/\/accounts\.google\.com\//);
    assert.deepEqual(backendCalls.map(row=>row.action),['token','start']);
  }finally{
    globalThis.fetch=previousFetch;
  }
});
