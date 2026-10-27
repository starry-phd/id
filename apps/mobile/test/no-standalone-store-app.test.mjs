import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {STARRY_ID_TEMPLATE} from '../src/brand-registry.ts';
const app=JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8')).expo;
test('Q105: Starry ID repo Expo harness is explicitly DEV, never a separate store app',()=>{
 assert.match(app.name, /Dev$/);
 assert.match(app.slug,/-dev$/);
 assert.match(app.scheme,/-dev$/);
 assert.match(app.ios.bundleIdentifier,/\.dev$/);
 assert.match(app.android.package,/\.dev$/);
 assert.equal(STARRY_ID_TEMPLATE.memberService,'starry-id');
 assert.equal(STARRY_ID_TEMPLATE.memberAuthEnabled,false);
 assert.equal(STARRY_ID_TEMPLATE.crossBrandSyncEnabled,false);
});
test('Q108/Q107: dev harness does not include ad network or approved region rollout',()=>{
 assert.equal('ads' in app,false);
 assert.equal('androidPermissions' in app,false);
 assert.equal('ios' in app && 'bundleIdentifier' in app.ios,true);
 const forbidden=/admob|google-mobile-ads|applovin|facebook-audience-network/i;
 assert.equal(forbidden.test(JSON.stringify(app)),false);
 assert.equal('eas' in app,false);
});
