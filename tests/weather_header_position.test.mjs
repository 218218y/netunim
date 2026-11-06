import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../netunim-orders/site/',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const css=readFileSync(new URL('assets/weather-link.css',root),'utf8');

test('the weather link is the first action to the right of the folder control in RTL',()=>{
  assert.match(html,/<html lang="he" dir="rtl">/);
  const nav=html.split('<div class="topbar-nav-cluster">')[1]?.split('<div class="topbar-actions">')[0];
  assert.ok(nav);
  assert.doesNotMatch(nav,/weatherLink|weather-link/);
  const actions=html.split('<div class="topbar-actions">')[1]?.split('</header>')[0];
  assert.ok(actions);
  const weather=actions.match(/<a\b[^>]*id="weatherLink"[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.ok(weather);
  assert.ok(actions.indexOf('id="weatherLink"')<actions.indexOf('class="folder-access-slot"'));
  assert.match(weather,/href="https:\/\/ims\.gov\.il\/he"/);
  assert.match(weather,/target="_blank"/);
  assert.match(weather,/rel="noopener noreferrer"/);
  assert.match(weather,/<svg\b[^>]*aria-hidden="true"/);
  assert.match(css,/\.topbar-actions \.weather-link/);
  assert.match(html,/href="\.\/assets\/weather-link\.css"/);
});
