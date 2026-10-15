import { spawn } from 'node:child_process';

// Native I/O adapter. The checked owner retains deadlines, limits and completion
// authority; close is the acknowledgement that all worker pipes have closed.
export function createPdfExtractionPlatform({
  executable,
  script,
  cwd,
  spawnWorker = spawn
}) {
  return {
    worker: {
      start(request, events) {
        const child = spawnWorker(executable, [script], {
          cwd,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', events.output);
        child.stderr.on('data', events.errorOutput);
        child.stdout.on('error', events.error);
        child.stderr.on('error', events.error);
        child.on('error', events.error);
        child.stdin.on('error', events.error);
        child.on('close', events.close);
        child.stdin.end(JSON.stringify(request));
        return {
          kill: () => {
            child.kill();
          }
        };
      }
    }
  };
}
