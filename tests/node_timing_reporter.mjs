import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Observe the parent runner's file completion, including plain assertion files
// and import failures. Child summaries alone miss plain assertion files and
// exclude process/import overhead. Named subtests are not file completions.
export default async function* fileTimings(events) {
  const counts = new Map();
  for await (const {type, data} of events) {
    if (type === 'test:summary' && data.file) {
      counts.set(data.file, data.counts);
    }
    if (type === 'test:complete' && data.file && data.nesting === 0
        && !data.entryFile && path.resolve(root, data.name) === path.resolve(data.file)) {
      yield JSON.stringify({
        file: path.relative(root, data.file).split(path.sep).join('/'),
        seconds: data.details.duration_ms / 1000,
        status: data.details.passed ? 'passed' : 'failed',
        counts: counts.get(data.file) ?? null,
      }) + '\n';
    }
  }
}
