import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { postVisaCalJson } from '../netunim-kupa/bank-bridge/credit-http.mjs';

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
