import { spawn } from 'node:child_process';
export function runProcess(command, args, { input = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', x => out += x);
        child.stderr.on('data', x => err += x);
        child.on('error', reject);
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
    const source = Buffer.from(text, 'utf8').toString('base64');
    const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();$raw=[Convert]::FromBase64String($s);$enc=[System.Security.Cryptography.ProtectedData]::Protect($raw,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($enc))";
    return runPowerShell(script, source);
}
export async function unprotectText(blob) {
    const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();$enc=[Convert]::FromBase64String($s);$raw=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($raw))";
    const plain64 = await runPowerShell(script, blob);
    return Buffer.from(plain64, 'base64').toString('utf8');
}
