import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { postVisaCalJson,maxGetJsonWithinPage } from '../netunim-kupa/bank-bridge/credit-http.mjs';

for(const payload of [null,{},[],{status:'200',body:'{}',retryAfter:''},
  {status:200.5,body:'{}',retryAfter:''},{status:200,body:[],retryAfter:''},
  {status:200,body:'{}',retryAfter:{seconds:5}}]){
  test('malformed in-page HTTP receipt is refused without provider fallback: '+JSON.stringify(payload),async()=>{
    let calls=0;
    const page={evaluate:async()=>payload};
    await assert.rejects(postVisaCalJson(page,async()=>{calls++;return new Response('{}')},
      'https://fixture.invalid',{}, {stage:'Frames'}),error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR'&&error.transport==='browser');
    assert.equal(calls,0);
    await assert.rejects(maxGetJsonWithinPage(page,'https://fixture.invalid','Transactions'),
      error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR');
  });
}

test('CAL and MAX preserve valid JSON/empty replies and do not grant authority to provider fields',async()=>{
  for(const [status,body,result] of [[200,'{"amount":"12.50","unknown":true}',{amount:'12.50',unknown:true}],
    [204,'',null],[200,'[1,2]',[1,2]]]){
    const page={evaluate:async()=>({status,body,retryAfter:''})};
    const cal=await postVisaCalJson(page,()=>assert.fail('unexpected fallback'),'https://fixture.invalid',{});
    assert.deepEqual(cal,{data:result,transport:'browser'});
    assert.deepEqual(await maxGetJsonWithinPage(page,'https://fixture.invalid','Transactions'),result);
  }
});

test('MAX network and HTTP failures stay classified without leaking raw payloads',async()=>{
  for(const [payload,code] of [[{networkError:'private network text'},'CREDIT_PROVIDER_NETWORK_ERROR'],
    [{status:403,body:'private provider HTML',retryAfter:''},'CREDIT_AUTOMATION_BLOCKED'],
    [{status:429,body:'private provider rate text',retryAfter:'5'},'CREDIT_PROVIDER_RATE_LIMITED'],
    [{status:200,body:'{private invalid body',retryAfter:''},'CREDIT_PROVIDER_RESPONSE_NOT_JSON']]){
    await assert.rejects(maxGetJsonWithinPage({evaluate:async()=>payload},'https://fixture.invalid','Transactions'),
      error=>error.code===code&&!error.message.includes('private'));
  }
});

for (const name of ['AbortError', 'TypeError'])
  test(
    'Cal Node transport classifies ' +
      name +
      ' during response-body acquisition as a scoped network failure',
    async () => {
      let requests = 0;
      const original = Object.assign(new Error('fixture body failure'), { name });
      const page = {
        evaluate: async () => {
          throw new TypeError('fixture browser request unavailable');
        },
      };
      const fetchImpl = async () => {
        requests++;
        return {
          status: 200,
          headers: { get: () => null },
          text: async () => {
            throw original;
          },
        };
      };
      await assert.rejects(
        postVisaCalJson(
          page,
          fetchImpl,
          'https://fixture.invalid',
          {},
          { stage: 'Transactions 2026-10' }
        ),
        (error) =>
          error.code === 'CREDIT_PROVIDER_NETWORK_ERROR' &&
          error.stage === 'Transactions 2026-10' &&
          error.causeName === name &&
          error.transport === 'node-fallback'
      );
      assert.equal(
        requests,
        1,
        'a failed body read cannot introduce an additional provider request'
      );
    }
  );

for (const bodyFailure of ['timeout', 'disconnect'])
  test(
    'Cal classifies a real ' + bodyFailure + ' after HTTP headers without retrying the provider',
    async (t) => {
      let requests = 0,
        response;
      const server = http.createServer((_request, res) => {
        requests++;
        response = res;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });
      const url = 'http://127.0.0.1:' + server.address().port;
      const fetchImpl = async (...args) => {
        const actual = await fetch(...args);
        if (bodyFailure === 'disconnect') response.destroy();
        return actual;
      };
      const page = {
        evaluate: async () => {
          throw new TypeError('fixture browser request unavailable');
        },
      };
      await assert.rejects(
        postVisaCalJson(page, fetchImpl, url, {}, { stage: 'Frames', timeoutMs: 200 }),
        (error) => {
          assert.equal(error.code, 'CREDIT_PROVIDER_NETWORK_ERROR');
          assert.equal(error.stage, 'Frames');
          assert.equal(error.transport, 'node-fallback');
          assert.equal(error.causeName, bodyFailure === 'timeout' ? 'AbortError' : 'TypeError');
          return true;
        }
      );
      assert.equal(requests, 1);
    }
  );

test('authoritative browser HTTP and JSON errors retain their classification without node fallback', async () => {
  for (const [status, body, code] of [
    [403, 'blocked', 'CREDIT_AUTOMATION_BLOCKED'],
    [429, 'limited', 'CREDIT_PROVIDER_RATE_LIMITED'],
    [200, '<html>fixture</html>', 'CREDIT_PROVIDER_RESPONSE_NOT_JSON'],
    [200, '{invalid', 'CREDIT_PROVIDER_RESPONSE_NOT_JSON'],
  ]) {
    let requests = 0;
    const page = { evaluate: async () => ({ status, body, retryAfter: '5' }) };
    await assert.rejects(
      postVisaCalJson(
        page,
        async () => {
          requests++;
          throw new Error('unexpected node fallback');
        },
        'https://fixture.invalid',
        {},
        { stage: 'Transactions' }
      ),
      (error) =>
        error.code === code && error.stage === 'Transactions' && error.transport === 'browser'
    );
    assert.equal(requests, 0);
  }
});
