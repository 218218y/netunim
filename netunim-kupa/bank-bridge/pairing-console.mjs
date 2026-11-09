import http from 'node:http';
import {createInterface} from 'node:readline/promises';
import {PAIRING_ADMIN_PATH, readPairingAdminToken} from './scoped-pairing.mjs';

const directAgent = new http.Agent({keepAlive: false});

export function requestLocalJson(port, pathname, {token = '', method = 'GET', body, timeoutMs = 5000} = {}) {
  return new Promise((resolve, reject) => {
    const input = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      agent: directAgent, signal: AbortSignal.timeout(timeoutMs),
      headers: {...(token ? {Authorization: 'Bearer ' + token} : {}),
        ...(input ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(input)} : {})},
    }, async res => {
      try {
        let text = '';
        for await (const chunk of res) {
          text += chunk.toString('utf8');
          if (text.length > 16384) throw Error('pairing response too large');
        }
        let data = {};
        try { data = JSON.parse(text); } catch {}
        resolve({response:{ok:res.statusCode===200},data});
      } catch (error) { reject(error); }
    });
    req.once('error', reject);
    req.end(input);
  });
}

export async function runPairingConsole({root, port, args, stdin = process.stdin, stdout = process.stdout}) {
  const [action = 'status', origin, ...permissions] = args;
  if (!['status', 'begin', 'issue', 'revoke', 'finish', 'prepare-rollback'].includes(action)) {
    throw Error('Use --pairing status | begin | issue ORIGIN PERMISSION... | revoke ORIGIN | finish | prepare-rollback');
  }
  const token = await readPairingAdminToken(root);
  if (action !== 'status') {
    if (!stdin.isTTY || !stdout.isTTY) throw Error('Open an interactive local terminal to approve pairing changes.');
    const console = createInterface({input: stdin, output: stdout});
    try {
      stdout.write(['Pairing action: ' + action, origin, permissions.join(' ')].filter(Boolean).join('\n') + '\n');
      const response = await console.question('Type APPROVE to continue: ');
      if (response !== 'APPROVE') return;
    } finally { console.close(); }
  }
  const {response,data:result} = await requestLocalJson(port, PAIRING_ADMIN_PATH, {
    token, method:'POST', body:{action, origin, permissions},
  });
  if (!response.ok || result?.ok !== true) throw Error('Pairing request rejected');
  if (action === 'issue') stdout.write('Paste this one-time code in the exact approved site within two minutes:\n' + result.code + '\n');
  else stdout.write(JSON.stringify(result, null, 2) + '\n');
}
