import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {
 ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View,
} from 'react-native';
import type {M2DeletionPort} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
import {createDeletionFlow} from './account-deletion-flow.ts';
import type {DeletionView} from './account-deletion-flow.ts';
import type {DeletionPreview} from './account-deletion-preview.ts';

export type AccountDeletionScreenProps=Readonly<{
 port:M2DeletionPort;
 preview:boolean;
 previewTools?:DeletionPreview;
}>;
function readableError(view:DeletionView):string{
 if(view.phase==='unauthorized')return '登入已失效，請先重新登入後再查詢或提出申請。';
 if(view.error==='DISABLED')return '此功能目前尚未開放，請稍後再試。';
 if(view.error==='NO_REQUEST'||view.error==='CONFLICT')return '申請狀態可能已變更，請重新查詢進度。';
 return '連線或服務暫時無法使用。可重新查詢或重試上一次操作。';
}
export function AccountDeletionScreen({port,preview,previewTools}:AccountDeletionScreenProps){
 const flow=useMemo(()=>createDeletionFlow(port),[port]);
 const view=useSyncExternalStore(flow.subscribe,flow.snapshot,flow.snapshot);
 useEffect(()=>{
  // React 19 StrictMode calls setup, cleanup, setup on one memoized flow.
  // Each new setup must rearm the exact port without allowing late results
  // from the previous generation to update this member's screen.
  flow.activate();
  void flow.refresh();
  return ()=>flow.invalidate();
 },[flow]);
 const loading=view.phase==='loading';
 const waiting=view.receipt?.status==='awaiting_second_confirmation';
 const pending=view.receipt?.status==='pending_processing';
 const issue=view.phase==='error'||view.phase==='unauthorized';
 const canInteract=preview||view.error!=='DISABLED';
 const action=(label:string,run:()=>Promise<void>,disabled=false,secondary=false)=>(
  <Pressable
   accessibilityRole="button"
   accessibilityLabel={label}
   disabled={disabled||loading}
   onPress={()=>{void run();}}
   style={[styles.button,secondary?styles.secondary:styles.primary,
    (disabled||loading)?styles.disabled:null]}>
   <Text style={secondary?styles.secondaryLabel:styles.primaryLabel}>{label}</Text>
  </Pressable>
 );
 const hint=(message:string)=>(
  <View style={styles.notice}><Text style={styles.noticeText}>{message}</Text></View>
 );
 return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
  <Text style={styles.eyebrow}>STARRY ID · 帳號管理</Text>
  <Text accessibilityRole="header" style={styles.title}>申請刪除帳號</Text>
  <Text style={styles.description}>
   提交申請需要兩次分開確認。此流程目前僅受理刪帳申請；
   申請受理不代表帳號、個人資料或備份已被實際清除。
  </Text>
  {preview?hint('本機操作演示｜不會送出真實刪帳申請，不會登入、存取會員資料或連接伺服器。'):
   hint('此畫面尚未連接已驗證的正式會員登入與刪帳服務。')}
  <View style={styles.panel}>
   <Text style={styles.sectionTitle}>申請進度</Text>
   {loading?<View style={styles.inline}>
    <ActivityIndicator accessibilityLabel="處理中" />
    <Text style={styles.meta}>正在處理，請勿重複點擊…</Text>
   </View>:null}
   {pending?<View accessibilityLiveRegion="polite">
    <Text style={styles.good}>申請已收到，尚在處理中</Text>
    <Text style={styles.meta}>
     兩次確認均已記錄。這不是刪除完成通知；請待後續正式處理與確認。
    </Text>
   </View>:waiting?<View accessibilityLiveRegion="polite">
    <Text style={styles.step}>第一次確認已收到</Text>
    <Text style={styles.meta}>
     尚未完成第二次確認。請再閱讀以下提醒，並按不同的確認按鈕才會送出。
    </Text>
   </View>:!loading&&!issue?<Text style={styles.meta}>目前沒有已受理的刪帳申請。</Text>:null}
   {issue?<View accessibilityLiveRegion="assertive">
    <Text style={styles.error}>{readableError(view)}</Text>
    {view.receipt?<Text style={styles.meta}>先前的申請紀錄仍保留，可重試或重新查詢。</Text>:null}
   </View>:null}
   {action('查詢申請進度',()=>flow.refresh(),!canInteract,true)}
  </View>
  <View style={styles.panel}>
   <Text style={styles.sectionTitle}>訂閱提醒</Text>
   <Text style={styles.meta}>
    目前無法在此查詢您是否有訂閱。如果您有透過 Apple App Store 或 Google Play 訂閱，
    提出刪帳申請不會自動取消商店訂閱。
    請自行前往原購買商店的訂閱管理確認與處理，避免持續扣款。
   </Text>
  </View>
  {!pending?<View style={styles.panel}>
   <Text style={styles.sectionTitle}>兩次獨立確認</Text>
   <Text style={styles.meta}>
    刪除帳號可能影響會員資料、存取權限及數位服務。
    重新註冊後原有購買權益能否恢復，目前政策尚未定案，無法保證自動恢復。
   </Text>
   {view.phase==='idle'&&!view.receipt?
    action('第一次確認：我要提出刪帳申請',()=>flow.requestFirst(),
     !canInteract):
    null}
   {view.phase==='awaiting_second_confirmation'&&waiting?
    action('第二次確認：確認送出刪帳申請',()=>flow.confirmSecond(),
     !canInteract):
    null}
   {issue&&view.phase==='error'?
    action('重試上一次操作',()=>flow.retry(),!canInteract,true):null}
  </View>:null}
  {preview&&previewTools?<View style={styles.preview}>
   <Text style={styles.meta}>開發預覽測試（以下操作只影響下一次本機模擬請求）</Text>
   {action('模擬下次服務暫時無法使用',async()=>{
    previewTools.failNext('UNAVAILABLE');
    await flow.refresh();
   },false,true)}
   {action('模擬下次登入失效',async()=>{
    previewTools.failNext('UNAUTHORIZED');
    await flow.refresh();
   },false,true)}
  </View>:null}
 </ScrollView>;
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F6F8FC'},
 content:{padding:20,paddingBottom:56,gap:18,maxWidth:540,width:'100%',alignSelf:'center'},
 eyebrow:{fontSize:12,letterSpacing:1.4,color:'#526780',fontWeight:'700'},
 title:{fontSize:29,fontWeight:'800',color:'#162F4F'},
 description:{fontSize:15,lineHeight:24,color:'#334963'},
 notice:{padding:15,backgroundColor:'#FFF2D8',borderRadius:12},
 noticeText:{fontSize:14,lineHeight:22,color:'#60450F'},
 panel:{padding:19,backgroundColor:'#FFFFFF',borderRadius:16,gap:13,
  borderWidth:1,borderColor:'#E1E8F0'},
 sectionTitle:{fontWeight:'800',fontSize:19,color:'#1E3654'},
 meta:{fontSize:14,lineHeight:22,color:'#40566F'},
 inline:{flexDirection:'row',alignItems:'center',gap:10},
 good:{color:'#135C43',fontSize:17,fontWeight:'700'},
 step:{color:'#7E500D',fontSize:17,fontWeight:'700'},
 error:{color:'#A52B35',fontSize:15,fontWeight:'700',lineHeight:23},
 button:{paddingVertical:15,paddingHorizontal:13,borderRadius:11,
  alignItems:'center',justifyContent:'center',minHeight:49},
 primary:{backgroundColor:'#19598E'},
 secondary:{backgroundColor:'#E7F0F9'},
 disabled:{opacity:0.45},
 primaryLabel:{color:'#FFFFFF',fontSize:15,fontWeight:'700',textAlign:'center'},
 secondaryLabel:{color:'#1D527C',fontSize:15,fontWeight:'700',textAlign:'center'},
 preview:{padding:12,borderWidth:1,borderColor:'#CBD7E8',
  borderRadius:12,borderStyle:'dashed',gap:10},
});
