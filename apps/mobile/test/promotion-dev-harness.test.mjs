import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
test('Expo selected promotion harness is development only with no real EAS or Store settings',()=>{
  const app=JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8')).expo;
  assert.match(app.slug,/-dev$/);assert.match(app.scheme,/-dev$/);
  assert.equal(app.ios.bundleIdentifier,'phd.starry.id.dev');
  assert.equal(app.android.package,'phd.starry.id.dev');
  assert.equal('ads' in app,false);assert.equal('eas' in app,false);
});
test('minimum mobile screen does not link to unimplemented member/login routes',()=>{
  const ui=readFileSync(new URL('../app/index.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/href="\/(member|auth|login)/);
  assert.match(ui,/development-only/i);
});
