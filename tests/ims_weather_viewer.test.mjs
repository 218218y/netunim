import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for(const site of ['orders','kupa']){
  test(`${site}: weather link opens the official website in a separate tab without a modal`,()=>{
    const root=new URL(`../netunim-${site}/site/`,import.meta.url);
    const html=readFileSync(new URL('index.html',root),'utf8');
    const main=readFileSync(new URL('assets/js/main.js',root),'utf8');
    const link=html.match(/<a\b[^>]*\bid="weatherTrigger"[^>]*>[\s\S]*?<\/a>/)?.[0];
    assert.ok(link,'weather entry must be a real link, usable without JavaScript');
    assert.match(link,/href="https:\/\/ims\.gov\.il\/he"/);
    assert.match(link,/target="_blank"/);
    assert.match(link,/rel="noopener noreferrer"/);
    assert.match(link,/<svg\b[^>]*aria-hidden="true"/);
    assert.match(link,/<span>מזג אוויר<\/span>/);
    assert.doesNotMatch(link,/aria-haspopup|aria-expanded/);
    assert.doesNotMatch(main,/installImsWeatherViewer|ims-weather-viewer\.js/);
    assert.match(html,/assets\/js\/shared\/ims-weather-viewer\.css/);
    const css=readFileSync(new URL('assets/js/shared/ims-weather-viewer.css',root),'utf8');
    const canonical=readFileSync(new URL('../shared/ims-weather-viewer.css',import.meta.url),'utf8');
    assert.equal(css,canonical,'site styles must be synchronized from shared CSS');
  });
}
