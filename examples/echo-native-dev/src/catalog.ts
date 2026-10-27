/** Explicitly fictitious DEV records. Never infer licensed audio or user permissions. */
export interface DemoTrack {
 readonly id:string;readonly title:string;readonly speaker:string;
 readonly category:string;readonly durationSeconds:number;
 readonly description:string;readonly mediaUri:null;readonly isDemo:true;
}
export const DEMO_TRACKS:readonly DemoTrack[]=Object.freeze([
 Object.freeze({id:'demo-001',title:'靜下來，聽見新的可能',speaker:'示範講者 A',
  category:'成長故事',durationSeconds:420,description:'演示音檔詳情、分類與閱讀狀態，沒有真實錄音。',
  mediaUri:null,isDemo:true as const}),
 Object.freeze({id:'demo-002',title:'把靈感變成每天的小行動',speaker:'示範講者 B',
  category:'生活靈感',durationSeconds:560,description:'使用合成的文字資料展示搜尋與播放入口。',
  mediaUri:null,isDemo:true as const}),
 Object.freeze({id:'demo-003',title:'一段值得記下來的分享',speaker:'示範講者 C',
  category:'精選分享',durationSeconds:700,description:'尚未載入任何正式會員、逐字稿、R2 音檔或付費內容。',
  mediaUri:null,isDemo:true as const})
]);
export function listDemoTracks(query=''):readonly DemoTrack[]{
 const q=query.normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
 if(!q)return DEMO_TRACKS;
 return DEMO_TRACKS.filter(t=>[t.title,t.speaker,t.category,t.description]
  .some(s=>s.normalize('NFKC').toLocaleLowerCase('zh-Hant').includes(q)));
}
export function getDemoTrack(id:unknown):DemoTrack|null{
 if(typeof id!=='string'||!/^demo-\d{3}$/.test(id))return null;
 return DEMO_TRACKS.find(t=>t.id===id)??null;
}
export function playbackGate(track:DemoTrack|null){
 return Object.freeze({canPlay:false,canDownload:false,canChargeBattery:false,
  canGrantEntitlement:false,canSendQueueAck:false,
  reason:track?'UNLICENSED_DEMO_MEDIA_NOT_PROVIDED':'UNKNOWN_DEMO_TRACK',
  source:'local_fictitious_fixture_only' as const});
}