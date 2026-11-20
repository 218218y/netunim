import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dpapiExecutable = fileURLToPath(new URL('./BankBridgeDpapi.exe', import.meta.url));

export function runProcess(command, args, { input = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', x => out += x);
        child.stderr.on('data', x => err += x);
        child.on('error', reject);
        child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
        child.on('close', code => code === 0 ? resolve(out.trim()) : reject(Object.assign(new Error(err.trim() || out.trim() || `${command} exited with ${code}`), { exitCode: code })));
        child.stdin.end(input);
    });
}
export function runPowerShell(script, input = '') {
    if (process.platform !== 'win32')
        return Promise.reject(new Error('Bank Bridge credential encryption is supported on Windows only'));
    return runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { input });
}
export async function protectText(text) {
    return runDpapi('protect', Buffer.from(text, 'utf8').toString('base64'));
}
export async function unprotectText(blob) {
    const plain64 = await runDpapi('unprotect', blob);
    return Buffer.from(plain64, 'base64').toString('utf8');
}

function runDpapi(operation, input) {
    if (process.platform !== 'win32')
        return Promise.reject(new Error('Bank Bridge credential encryption is supported on Windows only'));
    return runProcess(dpapiExecutable, [operation], { input });
}
