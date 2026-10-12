import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfIndexWriter} from '../netunim-orders/document-bridge/pdf-index-writer.mjs';
import {writerFixture,deferred,row} from './pdf_index_writer_fixture.mjs';

test('append stages actual serialized operations, commits before synchronous publication and preserves metadata',async()=>{
  const f=writerFixture(),commit=deferred(),append=f.ports.files.appendJournal;f.ports.files.appendJournal=async text=>{await commit.promise;await append(text)};
  const input={op:'upsert',entry:row('C:\\new.pdf','candidate')},work=f.writer.append([input]);input.entry.text='changed after capture';
  await Promise.resolve();assert.equal(f.published.length,0);commit.resolve();await work;
  const {candidate,phase}=f.published[0];assert.equal(phase,'append');assert.equal(candidate.entries.get('c:\\new.pdf').text,'candidate');assert.equal(candidate.pending,2);
  assert.equal((await f.recover()).entries.get('c:\\new.pdf').text,'candidate');
});
test('append failure preserves previous publication and does not perform a second write',async()=>{
  const f=writerFixture(),error=Object.assign(new Error('disk denied'),{code:'EACCES'}),before=JSON.stringify(f.disk);
  f.ports.files.appendJournal=async()=>{f.calls.push('failed append');throw error};await assert.rejects(f.writer.append([{op:'upsert',entry:row('C:\\new.pdf')}]),error);
  assert.deepEqual(f.calls,['failed append']);assert.equal(f.published.length,0);assert.equal(JSON.stringify(f.disk),before);
});
test('invalid exact wire records, including toJSON substitution, never enter a write',async()=>{
  for(const value of [null,{}, {op:'remove'}, {op:'upsert',entry:{fullPath:''}}, {op:'upsert',entry:row('C:\\new.pdf'),toJSON:()=>({op:'future'})}]){
    const f=writerFixture();await assert.rejects(f.writer.append([value]));assert.deepEqual(f.calls,[]);assert.equal(f.published.length,0);
  }
});
test('fresh invalid persisted input blocks append and compact without replacing files',async()=>{
  for(const operation of ['append','compact']){
    const f=writerFixture();f.disk.journal='{broken';const before=JSON.stringify(f.disk);
    await assert.rejects(operation==='append'?f.writer.append([{op:'remove',fullPath:'C:\\base.pdf'}]):f.writer.compact(),{code:'PDF_INDEX_JOURNAL_INVALID'});
    assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(f.disk),before);
  }
});
test('a changed signature between staging and commit blocks the write',async()=>{
  const f=writerFixture(),stage=f.ports.reader.stage;f.ports.reader.stage=(...args)=>{const candidate=stage(...args);f.disk.revision++;return candidate};
  await assert.rejects(f.writer.append([{op:'remove',fullPath:'C:\\base.pdf'}]),{code:'PDF_INDEX_WRITE_CHANGED'});assert.deepEqual(f.calls,[]);
});
test('compaction writes the complete snapshot before clearing and publishing',async()=>{
  const f=writerFixture();await f.writer.append([{op:'upsert',entry:row('C:\\new.pdf')},{op:'remove',fullPath:'C:\\base.pdf'}]);f.calls.length=0;
  await f.writer.compact({pending:1,pdfCount:7});assert.deepEqual(f.calls,['snapshot','clear']);assert.equal(f.disk.journal,'');
  const current=f.published.at(-1).candidate,recovered=await f.recover();assert.equal(current.pending,1);assert.equal(recovered.pending,1);assert.equal(recovered.pdfCount,7);
  assert.deepEqual([...recovered.entries.values()],[row('C:\\new.pdf')]);
});
test('snapshot failure cannot clear the journal or update operator metadata',async()=>{
  const f=writerFixture();await f.writer.append([{op:'upsert',entry:row('C:\\new.pdf')}]);const before=JSON.stringify(f.disk),publications=f.published.length;
  f.ports.files.replaceSnapshot=async()=>{throw Object.assign(new Error('quota'),{code:'ENOSPC'})};await assert.rejects(f.writer.compact({pending:0}),{code:'ENOSPC'});
  assert.equal(JSON.stringify(f.disk),before);assert.equal(f.published.length,publications);assert.deepEqual(f.calls,['append']);
});
test('journal-clear failure retains old complete replay and no compaction success publication',async()=>{
  const f=writerFixture();await f.writer.append([{op:'upsert',entry:row('C:\\new.pdf')},{op:'remove',fullPath:'C:\\base.pdf'}]);const journal=f.disk.journal,publications=f.published.length;
  f.ports.files.clearJournal=async()=>{throw new Error('clear denied')};await assert.rejects(f.writer.compact(),/clear denied/);assert.equal(f.disk.journal,journal);assert.equal(f.published.length,publications);
  assert.deepEqual([... (await f.recover()).entries.values()],[row('C:\\new.pdf')]);
});
test('post-commit publication failure is distinct and durable records still recover',async()=>{
  const f=writerFixture(),cause=new Error('consumer failed');f.ports.publish=()=>{throw cause};const writer=createPdfIndexWriter(f.ports);
  await assert.rejects(writer.append([{op:'upsert',entry:row('C:\\new.pdf')}]),error=>error.code==='PDF_INDEX_COMMITTED_PUBLICATION_FAILED'&&error.committed===true&&error.cause===cause);
  assert.equal((await f.recover()).entries.has('c:\\new.pdf'),true);assert.deepEqual(f.calls,['append']);
});
test('an invalid async publisher is rejected and its rejection is observed without hiding the committed write',async()=>{
  const f=writerFixture(),writer=createPdfIndexWriter({...f.ports,publish:async()=>{throw new Error('async consumer failed')}});
  await assert.rejects(writer.append([{op:'upsert',entry:row('C:\\new.pdf')}]),{code:'PDF_INDEX_COMMITTED_PUBLICATION_FAILED'});
  assert.equal((await f.recover()).entries.has('c:\\new.pdf'),true);await Promise.resolve();
});
test('cached heads avoid repeated full replay but an external writer forces a fresh read',async()=>{
  const f=writerFixture();for(let i=0;i<30;i++)await f.writer.append([{op:'upsert',entry:row(`C:\\${i}.pdf`)}]);assert.equal(f.reads(),1);
  f.disk.journal+=JSON.stringify({op:'upsert',entry:row('C:\\external.pdf')})+'\n';f.disk.revision++;
  await f.writer.append([{op:'upsert',entry:row('C:\\next.pdf')}]);assert.equal(f.reads(),2);assert.equal(f.published.at(-1).candidate.entries.has('c:\\external.pdf'),true);
});
test('concurrent append and compact preserve each captured update in serialized lock order',async()=>{
  const f=writerFixture();await Promise.all([f.writer.append([{op:'upsert',entry:row('C:\\a.pdf')}]),f.writer.compact(),f.writer.append([{op:'upsert',entry:row('C:\\b.pdf')}])]);
  assert.deepEqual([... (await f.recover()).entries.keys()],['c:\\base.pdf','c:\\a.pdf','c:\\b.pdf']);assert.deepEqual(f.calls,['append','snapshot','clear','append']);
});
test('invalid compaction counts or serializer identity fail before any file replacement',async()=>{
  for(const pending of [-1,NaN,Infinity,1.5]){const f=writerFixture();await assert.rejects(f.writer.compact({pending}));assert.deepEqual(f.calls,[])}
  const f=writerFixture(),writer=createPdfIndexWriter({...f.ports,serializeEntry:entry=>({...entry,fullPath:'C:\\wrong.pdf'})});await assert.rejects(writer.compact(),/serialization_changed/);assert.deepEqual(f.calls,[]);
});
test('empty append performs no I/O and missing ports are rejected before entry',async()=>{
  const f=writerFixture();await f.writer.append([]);assert.equal(f.reads(),0);assert.deepEqual(f.calls,[]);assert.throws(()=>createPdfIndexWriter({...f.ports,publish:null}),/ports_required/);
});
