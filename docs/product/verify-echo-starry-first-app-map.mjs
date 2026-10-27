import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';

const expectedEntries=[["container/audio-segmenter/server.mjs","203068f0af7089331d61a3f6f0d0f5400357c97d"],["package.json","184c16a3521816ab2f5b8c96fc62464bba456913"],["public/manifest.webmanifest","6d765e1e67a070200021a33075fad3ede109857b"],["public/sw.js","2e907eeda1804071b0a2ae187d1b699302489c59"],["shared/learningProgress.ts","ceb662787008a8316be4b7ab47cd5422b2755c1a"],["shared/qaAnswerRules.ts","fc48836dcc0792e8caa6ba0f758b01f4d1b2d7ce"],["shared/speakers.ts","87277cbe0e2cd1eb6ad93d499d83defe95fb7ad9"],["shared/stickers.ts","ba2d4a93bcac2a5a0fcdffd3435fd93a192656d1"],["src/App.tsx","f65f2b910ea8df2ac1e4265ea5a092496c05222a"],["src/components/AdminModal.tsx","eca93e7df6df0483a1f02a671b10fd0245eeda98"],["src/components/AiQuestionSettingsAdmin.tsx","a12c8a1eb0168b754bd220f437304c03b837d01f"],["src/components/AudioCard.tsx","fff6a3dcad7e2d04e6120e9153e04224ca0e1064"],["src/components/AudioTrackList.tsx","b4325f163a5931159148eab2506b669800512750"],["src/components/AudioWorkspacePage.tsx","b5a161a3901728bc14c7f3600bf28174abad6f98"],["src/components/CommentsSection.tsx","f60977ee8c5c7a53f57d99f7d3010f6aaf042ef7"],["src/components/DetailView.tsx","66c4718dfcb43ce815518fbf7052539d96202dde"],["src/components/KeywordsTab.tsx","4dfb6ccdc00c780190bd024904e8b08b2a362395"],["src/components/MiniPlayer.tsx","785aa285d598b71451e21a5109dad800037415de"],["src/components/NotificationsView.tsx","6d0668d35000f6ca909a852fc108e9f03ff108af"],["src/components/ProfileModal.tsx","d46bc9ffa20b1441826893278e3f80f7b0acab3f"],["src/components/ShareModal.tsx","96232033614cfb828cf1dd2d9ae516cf1ca3e771"],["src/components/SpeakerProfilePage.tsx","a090ef321cbb2282c50dd009924f550930789406"],["src/components/StatisticsView.tsx","08cdf44ee16273de982a447df3b33babdf99f706"],["src/components/StickersModal.tsx","92f459e04e3ca3a64650116e39a521f8f6b90096"],["src/components/TranscriptQaAdmin.tsx","e0c2dcd754ffcc01d2a74d72bc11c4155864ff99"],["src/components/UploadModal.tsx","45c104d8b067fbdf797620be75f41dd73cf94be5"],["src/components/VipTracksTab.tsx","eace9ce17647411afa31d94adfbca17fc6a5c8ce"],["src/ecosystemSsoClient.ts","c25c80eddf551d7ceb653698266d316558d5ee3e"],["src/mediaSessionPolicy.ts","ffcd51b0427f111b1ab379bc462c1a19499e7a07"],["src/utils/audio.ts","ffc8749488d6cbc6eba6b1aa68e410b1f226180f"],["src/utils/keywords.ts","52ac98e1b402d1a842cd12cf154ce1689005de5d"],["src/utils/offlineAudio.ts","b1669a4445f2712ec140f40cb5a31c62e17f8ea8"],["src/utils/visitor.ts","120e8f0accea3b8726a0ec3a3e5cff1a178219cc"],["tests/learningProgress.test.ts","dc91fcfbaeb1bef42bca05df42f1a0cdce32f947"],["tests/mediaSessionPolicy.test.ts","b47e02c66ffba9b43e3a61f9adb4d190c3614b22"],["tests/offlineAudioBehavior.test.ts","3760e29803b3546b7db0d2f414151c1b936bbc8a"],["tests/shareLinks.test.ts","cedc660ffe94602a2f81c6d08944003cc3284ef5"],["tests/stickerTransactions.test.ts","afdd102e97e2d3be96ee011b55b9069268da2899"],["tests/transcriptV290Isolation.test.ts","b7a81a3b754e6adf9f056933622938eadc22fce9"],["worker/aiSpeakerProfileRouter.ts","72a415061b99b4af16f09f647cfb64e521b4121d"],["worker/aiSpeakerQaRouter.ts","bebcf5f4d8bf9a7a2829d2079a209d062385f5cd"],["worker/audioSegmenterContainer.ts","4d9a69980c8a4f18e1d10f44fd0fa02aa0701865"],["worker/authRouter.ts","ecadf5ecef636ac017742d4c5062a64aad8faa14"],["worker/batteryRouter.ts","f8a292126fdc9c7784edabd4076875160f1bd503"],["worker/community.ts","f82bf917e74cc582d88290d590594b804aedeef6"],["worker/favoriteRouter.ts","d08941e69bc003984995baa383775ed727019621"],["worker/organizationRouter.ts","2fff3781f147b36fe28e914fc732f32bd114e31f"],["worker/playbackOwnerRouter.ts","21ff49a099c643692b724a2657d1ff718e097429"],["worker/privacyCrawlerRouter.ts","7d14cd96e428a589c4568716b4e5478a610c6c8a"],["worker/shareRouter.ts","e96c6385379709aea7d0acd1f61c45f4c37820b5"],["worker/transcriptRouter.ts","0ccb81865eefe2fcba681d24deaf63911e2e49b6"],["worker/transcriptWorkflowV282.ts","b54757c74c120784455dee5f695781859f67860b"],["wrangler.toml","57310e6adf086e075c001bce3ac5d1098d580727"]];
const EXPECTED=[{"id":"EH-01","phase":"P0","owner":"AI-4","paths":["src/App.tsx","src/components/AudioCard.tsx"]},{"id":"EH-02","phase":"P0","owner":"AI-4","paths":["src/components/KeywordsTab.tsx","src/utils/keywords.ts"]},{"id":"EH-03","phase":"P0","owner":"AI-4","paths":["src/components/AudioTrackList.tsx","worker/community.ts"]},{"id":"EH-04","phase":"P0","owner":"AI-4","paths":["src/components/DetailView.tsx"]},{"id":"EH-05","phase":"P0","owner":"AI-4","paths":["src/components/MiniPlayer.tsx","src/utils/audio.ts"]},{"id":"EH-06","phase":"P0","owner":"AI-4","paths":["src/mediaSessionPolicy.ts","tests/mediaSessionPolicy.test.ts"]},{"id":"EH-07","phase":"P0","owner":"AI-4","paths":["src/utils/offlineAudio.ts","tests/offlineAudioBehavior.test.ts"]},{"id":"EH-08","phase":"P0","owner":"AI-3","paths":["src/utils/audio.ts","worker/playbackOwnerRouter.ts"]},{"id":"EH-09","phase":"P0","owner":"AI-1","paths":["src/utils/visitor.ts","src/ecosystemSsoClient.ts"]},{"id":"EH-10","phase":"P0","owner":"AI-2","paths":["src/components/VipTracksTab.tsx","worker/community.ts"]},{"id":"EH-11","phase":"P0","owner":"AI-4","paths":["src/components/AudioCard.tsx","worker/favoriteRouter.ts"]},{"id":"EH-12","phase":"P0","owner":"AI-4","paths":["src/components/SpeakerProfilePage.tsx","worker/aiSpeakerProfileRouter.ts"]},{"id":"EH-13","phase":"P0","owner":"AI-4","paths":["worker/community.ts","wrangler.toml"]},{"id":"EH-14","phase":"P0","owner":"AI-4","paths":["worker/community.ts","worker/transcriptRouter.ts"]},{"id":"EH-15","phase":"P1","owner":"AI-4","paths":["src/components/ShareModal.tsx","worker/shareRouter.ts","tests/shareLinks.test.ts"]},{"id":"EH-16","phase":"P1","owner":"AI-4","paths":["src/components/CommentsSection.tsx","worker/community.ts"]},{"id":"EH-17","phase":"P1","owner":"AI-4","paths":["src/components/NotificationsView.tsx"]},{"id":"EH-18","phase":"P1","owner":"AI-4","paths":["src/components/TranscriptQaAdmin.tsx","worker/transcriptRouter.ts"]},{"id":"EH-19","phase":"P1","owner":"AI-3","paths":["worker/transcriptWorkflowV282.ts","worker/transcriptRouter.ts"]},{"id":"EH-20","phase":"P1","owner":"AI-3","paths":["shared/learningProgress.ts","tests/learningProgress.test.ts"]},{"id":"EH-21","phase":"P1","owner":"AI-1","paths":["src/components/ProfileModal.tsx","worker/authRouter.ts"]},{"id":"EH-22","phase":"P1","owner":"AI-4","paths":["src/App.tsx","src/components/DetailView.tsx"]},{"id":"EH-23","phase":"P1","owner":"AI-4","paths":["src/components/ShareModal.tsx","src/components/DetailView.tsx"]},{"id":"EH-24","phase":"P2","owner":"AI-2","paths":["src/components/StickersModal.tsx","shared/stickers.ts","tests/stickerTransactions.test.ts"]},{"id":"EH-25","phase":"P2","owner":"AI-2","paths":["src/components/VipTracksTab.tsx","worker/batteryRouter.ts"]},{"id":"EH-26","phase":"P2","owner":"AI-4","paths":["worker/aiSpeakerQaRouter.ts","shared/qaAnswerRules.ts"]},{"id":"EH-27","phase":"P2","owner":"AI-4","paths":["worker/aiSpeakerProfileRouter.ts","src/components/SpeakerProfilePage.tsx"]},{"id":"EH-28","phase":"P2","owner":"AI-4","paths":["src/components/UploadModal.tsx","src/components/AudioWorkspacePage.tsx"]},{"id":"EH-29","phase":"P2","owner":"AI-4","paths":["src/components/TranscriptQaAdmin.tsx"]},{"id":"EH-30","phase":"P2","owner":"AI-4","paths":["src/components/AiQuestionSettingsAdmin.tsx"]},{"id":"EH-31","phase":"P2","owner":"AI-1","paths":["src/components/AdminModal.tsx","worker/organizationRouter.ts"]},{"id":"EH-32","phase":"P2","owner":"AI-4","paths":["src/components/StatisticsView.tsx"]},{"id":"EH-33","phase":"P2","owner":"AI-4","paths":["worker/audioSegmenterContainer.ts","container/audio-segmenter/server.mjs"]},{"id":"EH-34","phase":"P2","owner":"AI-4","paths":["public/manifest.webmanifest","public/sw.js"]},{"id":"EH-35","phase":"P1","owner":"AI-4","paths":["shared/speakers.ts"]},{"id":"EH-36","phase":"P2","owner":"AI-4","paths":["shared/qaAnswerRules.ts"]},{"id":"EH-37","phase":"P0","owner":"AI-1","paths":["worker/authRouter.ts","worker/privacyCrawlerRouter.ts"]},{"id":"EH-38","phase":"P0","owner":"AI-4","paths":["worker/community.ts","worker/shareRouter.ts"]},{"id":"EH-39","phase":"P0","owner":"AI-4","paths":["tests/offlineAudioBehavior.test.ts","tests/mediaSessionPolicy.test.ts","tests/transcriptV290Isolation.test.ts"]},{"id":"EH-40","phase":"P0","owner":"AI-4","paths":["wrangler.toml","package.json"]}];
const denialKeys=["repo_or_file_migration_approved","legacy_prod_read_or_write","actual_user_data_transfer","cloudflare_deployment","real_d1_or_r2_write","queue_ack","real_store_or_iap","paid_ai_call","buy_or_convert_free_battery","release_gates_overridden","merge_main","expo_eas_build","hglobal_work","publishable"];
const fixedParent='fbd5c03156da700b68c7b5bceb65269cb7c900ec',fixedLegacy='82cbf4f112af57fcfed12ff2f6cf86010c03560e';
export function auditEchoFirstAppRebuild(v,official,portfolio,ux,expo){
 const errors=[],bad=s=>errors.push(s);
 if(!v||!official||!portfolio||!ux||!expo)return {ok:false,errors:['missing official inputs']};
 const g=preflight(official);
 if(!g.valid||g.blocked.length!==11||g.manual_review_eligible||
  official.release_authorization?.granted!==false||
  official.deployment_automation?.can_auto_deploy!==false)
   bad('formal G00-G10 must remain blocked');
 if(v.schema_version!=='0.1.0-draft'||
  v.kind!=='AI0_ECHO_STARRY_LEGACY_REBUILD_FEATURE_MAP_NOT_MVP_APPROVAL'||
  v.scope!=='starry_echo_starry_first_app_planning_only'||
  v.authoritative_selection?.first_starry_app_name!=='繁星回聲'||
  v.authoritative_selection?.user_selected_first_app!==true||
  v.authoritative_selection?.legacy_repo!=='yukidu/Echo-Starry'||
  v.authoritative_selection?.legacy_commit_sha!==fixedLegacy||
  v.authoritative_selection?.native_architecture_proposal!==
   'React Native + Expo Router + TypeScript, universal web with platform-specific adapters')
   bad('Echo first-app selection or source provenance drift');
 const selection=v.authoritative_selection||{};
 for(const k of ['official_mvp_scope_approved','official_store_ids_approved','app_built','existing_generic_consumer_a_is_the_echo_app'])
  if(selection[k]!==false)bad('false product gate '+k);
 const ss=v.source_snapshot||{},src=v.new_architecture_source||{};
 if(ss.legacy_repo!=='yukidu/Echo-Starry'||ss.legacy_ref!=='main'||
  ss.legacy_commit_sha!==fixedLegacy||
  ss.verification_claim!=='remote_git_blob_shas_observed_by_github_api_not_rechecked_during_offline_ci'||
  src.repo!=='starry-phd/id'||src.verified_r21_pr!==148||
  src.verified_r21_sha!==fixedParent||src.candidate_ux_only_pr!==136||
  src.f0_prior_research_only_pr!==140||
  src.official_release_file!=='docs/release-readiness/release-readiness.v0.json'||
  src.current_expo_harness_is_consumer_echo_app!==false)
   bad('source SSOT or verification claim mismatch');
 const hash=ss.captured_legacy_file_blob_shas||{};
 if(JSON.stringify(Object.entries(hash))!==JSON.stringify(expectedEntries))
  bad('legacy GitHub source path/blob SHA snapshot modified');
 const c=v.catalogue||{},f=c.features||[];
 if(!Array.isArray(f)||f.length!==40||c.audited_file_count!==expectedEntries.length||
  c.full_legacy_code_review_complete!==false||c.selected_official_mvp_feature_count!==0||
  c.all_40_features_implemented!==false||c.acceptance_is_proposal_not_evidence!==true)
   bad('invented audit completeness, MVP approval or feature implementation');
 for(let i=0;i<EXPECTED.length;i++){
  const want=EXPECTED[i],a=f[i];
  if(!a||a.id!==want.id||a.phase!==want.phase||a.owner!==want.owner||
   JSON.stringify(a.legacy_paths)!==JSON.stringify(want.paths)||
   !a.legacy_paths?.every(p=>/^[0-9a-f]{40}$/.test(hash[p]||''))||
   a.evidence_level!=='legacy_paths_verified_at_pinned_sha'||
   a.selected_for_official_mvp!==false||
   a.implementation_status!=='not_started_or_not_verified'||
   a.review_status!=='proposal_only'||typeof a.proposed_acceptance!=='string'||
   a.proposed_acceptance.length<14)
   bad('unsupported or falsely approved feature '+want.id);
 }
 const counts={P0:0,P1:0,P2:0};
 for(const x of f){if(x?.phase in counts)counts[x.phase]++;}
 if(counts.P0<12||counts.P1<7||counts.P2<8)bad('feature waves or count changed');
 if(portfolio.authoritative_decisions?.first_consumer_app_selected!==false||
  ux.candidate?.approved!==false||ux.candidate?.ui_implemented!==false||
  expo.expo?.slug!=='starry-id-dev')bad('historical candidate plan or Dev harness altered unexpectedly');
 // Old portfolio says no first app yet: this is a superseded planning snapshot,
 // not permission to overwrite the old Gate or pretend Echo build exists.
 const d=v.implementation_design||{};
 if(d.ui_routes_created!==false||d.external_cost_benchmark_done!==false||
  d.android_ios_real_device_tested!==false||
  d.privacy_and_copyright_review_pending!==true||
  d.separation?.identity!=='shared new Starry ID Auth service via approved interface')
   bad('no Echo actual app, device or media authority yet');
 for(const k of denialKeys)if(v.no_permission?.[k]!==false)bad('unauthorized real operation '+k);
 for(const [k,val] of Object.entries(v.no_permission||{}))
  if(!denialKeys.includes(k)||val!==false)bad('unknown permission enabled '+k);
 if(!Array.isArray(v.decisions_pending)||v.decisions_pending.length!==8||
  v.decisions_pending.some(s=>typeof s!=='string'||!s.startsWith('ECHO-D')))
   bad('Echo human MVP decisions missing');
 return {ok:errors.length===0,errors,catalogue_count:f.length,unique_legacy_paths:expectedEntries.length,
  by_wave:counts,official_release_gates_blocked:g.blocked.length,
  first_app_named:'繁星回聲',actual_echo_native_app_built:false,official_mvp_approved:false};
}
export function readEchoFirstAppInputs(){
 return {plan:JSON.parse(readFileSync(new URL('./echo-starry-first-app-legacy-feature-map.v0.json',import.meta.url),'utf8')),
  release:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8')),
  portfolio:JSON.parse(readFileSync(new URL('../operations/future-starry-app-portfolio.v0.json',import.meta.url),'utf8')),
  ux:JSON.parse(readFileSync(new URL('./starry-consumer-a-candidate.v0.json',import.meta.url),'utf8')),
  expo:JSON.parse(readFileSync(new URL('../../apps/mobile/app.json',import.meta.url),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const x=readEchoFirstAppInputs(),r=auditEchoFirstAppRebuild(x.plan,x.release,x.portfolio,x.ux,x.expo);
 if(!r.ok){console.error('Echo first App inventory FAIL: '+r.errors.join(' | '));process.exitCode=1;}
 else console.log('Echo first App selected; '+r.catalogue_count+' legacy feature candidates / '+r.unique_legacy_paths+
 ' pinned legacy GitHub source blobs; MVP NOT approved; Echo native UI NOT built; '+r.official_release_gates_blocked+'/11 release Gates BLOCKED.');
}
