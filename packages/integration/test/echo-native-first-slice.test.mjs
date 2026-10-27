import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {listDemoTracks,getDemoTrack,playbackGate,DEMO_TRACKS} from '../../../examples/echo-native-dev/src/catalog.ts';
const root=new URL('../../../examples/echo-native-dev/',import.meta.url);
test('Echo Native sample is a real separated Expo Router project, not the Starry ID Dev App',()=>{
 const pkg=JSON.parse(readFileSync(new URL('package.json',root)));
 const cfg=JSON.parse(readFileSync(new URL('app.json',root)));
 assert.equal(pkg.main,'expo-router/entry');
 assert.equal(pkg.name,'echo-starry-native-dev-prototype');
 assert.equal(cfg.expo.name,'繁星回聲 DEV');
 assert.equal(cfg.expo.slug,'echo-starry-dev-prototype');
 assert.equal(cfg.expo.ios.bundleIdentifier,undefined);
 assert.equal(cfg.expo.android?.package,undefined);
 for(const p of ['app/_layout.tsx','app/index.tsx','app/track/[id].tsx','app/player/[id].tsx','app/about.tsx'])
 assert.equal(existsSync(new URL(p,root)),true,p);
});
test('Echo DEV catalog genuine search, zero approved media URI or personal data',()=>{
 assert.equal(DEMO_TRACKS.length,3);
 assert.equal(listDemoTracks('  ').length,3);
 assert.equal(listDemoTracks('示範講者 A').length,1);
 assert.equal(listDemoTracks('生活靈感').length,1);
 assert.equal(listDemoTracks('  不存在的曲目 ').length,0);
 assert.equal(getDemoTrack('demo-001')?.id,'demo-001');
 assert.equal(getDemoTrack('../live'),null);
 assert.equal(getDemoTrack(123),null);
 assert.equal(DEMO_TRACKS.every(x=>x.isDemo&&x.mediaUri===null&&!('memberId' in x)&&!('price' in x)),true);
});
test('Echo no authorized audio = fail-closed playback, download, Wallet, Queue, rights',()=>{
 const p=playbackGate(getDemoTrack('demo-001')),m=playbackGate(null);
 for(const x of [p,m]){
  assert.equal(x.canPlay,false);assert.equal(x.canDownload,false);
  assert.equal(x.canChargeBattery,false);assert.equal(x.canGrantEntitlement,false);
  assert.equal(x.canSendQueueAck,false);
 }
 assert.equal(m.reason,'UNKNOWN_DEMO_TRACK');
});
test('Echo DEV page cannot include WebView, hardcoded real media or release success',()=>{
 for(const file of ['app/index.tsx','app/track/[id].tsx','app/player/[id].tsx']){
  const src=readFileSync(new URL(file,root),'utf8');
  assert.doesNotMatch(src,/WebView|window\.|document\.|localStorage\.|CacheStorage|https:\/\/echo\.starry\.phd|https:\/\/id\.starry\.phd/);
 }
 const player=readFileSync(new URL('app/player/[id].tsx',root),'utf8');
 assert.match(player,/disabled=\{!state.canPlay\}/);
 assert.match(player,/disabled=\{!state.canDownload\}/);
});
