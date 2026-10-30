// Optional comparison only: npm install --prefix .work/build-poc vite@8.3.5
// No Vite dependency or second production build path is shipped.
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT} from './production-build.mjs';
const {build} = await import(pathToFileURL(path.join(ROOT, '.work/build-poc/node_modules/vite/dist/node/index.js')).href);
const observations = {};
for (const app of ['orders', 'kupa']) {
  const site = path.join(ROOT, `netunim-${app}/site`);
  const started = performance.now();
  try {
    const result = await build({root: site, configFile: false, logLevel: 'warn', build: {
      outDir: path.join(ROOT, '.work/build-poc', app), write: false,
      modulePreload: false, rolldownOptions: {input: {app: path.join(site, 'assets/app.js'), reset: path.join(site, 'reset-local.html')}},
    }});
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(row => row.output);
    observations[app] = {ok: true, milliseconds: performance.now() - started, files: outputs.map(row => ({name: row.fileName, bytes: Buffer.byteLength(row.code || row.source || '')}))};
  } catch (error) {
    observations[app] = {ok: false, milliseconds: performance.now() - started, error: String(error)};
  }
}
await fs.writeFile(path.join(ROOT, '.work/build-poc/result.json'), JSON.stringify(observations, null, 2));
console.log(JSON.stringify(observations));
