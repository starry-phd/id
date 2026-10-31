/** Starry ID M1 member screen: React Native / Expo / Web.
 * No public Auth, test bearer, credential storage or fake member data.
 * Receives only the existing, Auth-owned, scoped M1 SDK port.
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {
 ActivityIndicator,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View,
} from 'react-native';
import type {createM1StagingSelfClient,M1StagingSelf,M1SelfPatch}
 from '../../../packages/sdk/src/m1-staging-self-client.ts';
import type {MemberProfilePreview} from './member-profile-preview.ts';

export const M1_MEMBER_PROFILE_SCREEN_LIVE_ENABLED=false as const;
export type MemberProfilePort=Pick<ReturnType<typeof createM1StagingSelfClient>,
 'getSelf'|'patchSelfForUser'|'logout'>;
export type MemberProfileScreenProps=Readonly<{
 port:MemberProfilePort;enabled:boolean;
 /** Token-free revision from ONE trusted native Auth owner, never a bearer. */
 sessionRevision?:number;
 preview?:boolean;previewTools?:MemberProfilePreview;
}>;
type Phase='disabled'|'loading'|'ready'|'saving'|'logging_out'|'logged_out'|'reauth_required'|'error';
/** Any signed Session loss must erase stale PII, not leave editable data. */
export function isM1SessionLost(error:unknown):boolean{
 return error instanceof Error&&(
  error.message==='STARRY_SELF_UNAUTHORIZED'||
  error.message==='STARRY_SELF_SESSION_REQUIRED'||
  error.message==='STARRY_SELF_IDENTITY_CHANGED'
 );
}
const explanation=(error:unknown):string=>{
 if(!(error instanceof Error))return '服務暫時無法使用，請稍後重試。';
 switch(error.message){
  case 'STARRY_SELF_UNAUTHORIZED':
  case 'STARRY_SELF_SESSION_REQUIRED':
  case 'STARRY_SELF_IDENTITY_CHANGED':return '登入狀態已切換，請重新登入。';
  case 'STARRY_SELF_CONFLICT':return '會員資料已在其他地方更新，請重新讀取後再儲存。';
  case 'STARRY_SELF_FIELDS_DENIED':return '填寫的資料不符合要求，請檢查姓名與選項。';
  case 'STARRY_SELF_REVISION_REQUIRED':return '資料版本已變更，請重新讀取後再儲存。';
  default:return '服務暫時無法使用，請稍後重試。';
 }
};
/** A lost logout POST response does not prove whether server revocation happened.
 * Hide the former member until a fresh authenticated GET settles the result.
 * UI gets sanitized text only; this helper never exposes server error details.
 */
export function failedM1LogoutScreenState(error:unknown):Readonly<{
 phase:'reauth_required'|'error';notice:string;
}>{
 if(isM1SessionLost(error))
  return Object.freeze({phase:'reauth_required' as const,notice:explanation(error)});
 return Object.freeze({
  phase:'error' as const,
  notice:'登出結果尚無法確認，個人資料已隱藏。請重新讀取登入狀態；若已失效，請重新登入。',
 });
}

/** A failed PATCH can have committed its CAS before the response was lost.
 * Never reuse a potentially old version or show unconfirmed privacy toggles.
 * Only input rejection is safe to leave editable without a fresh server GET.
 */
export function failedM1SaveScreenState(error:unknown):Readonly<{
 phase:'ready'|'reauth_required'|'error';keepDraft:boolean;notice:string;
}>{
 if(isM1SessionLost(error))return Object.freeze({
  phase:'reauth_required' as const,keepDraft:false,notice:explanation(error),
 });
 if(error instanceof Error&&error.message==='STARRY_SELF_FIELDS_DENIED')
  return Object.freeze({
   phase:'ready' as const,keepDraft:true,notice:explanation(error),
  });
 const conflict=error instanceof Error&&error.message==='STARRY_SELF_CONFLICT';
 return Object.freeze({
  phase:'error' as const,keepDraft:false,
  notice:conflict?
   '會員資料已在其他地方更新，原顯示內容已隱藏。請重新讀取。':
   '儲存結果尚無法確認，個人資料已隱藏。請重新讀取，確認隱私設定是否已套用。',
 });
}

/** A profile may render only for the exact original Session revision and
 * owner port. A port or Auth generation change hides A on the FIRST render,
 * before React's async effect cleanup can fetch B. */
export function isM1CurrentProfileAuthority(
 loaded:Readonly<{port:MemberProfilePort;revision:number}>|null,
 port:MemberProfilePort,revision:number,enabled:boolean,
):boolean{
 return enabled===true&&Number.isSafeInteger(revision)&&revision>=0&&
  loaded!==null&&loaded.port===port&&loaded.revision===revision;
}

export function MemberProfileScreen({port,enabled,sessionRevision=0,preview=false,previewTools}:MemberProfileScreenProps){
 const generation=useRef(0);
 const busy=useRef(false);
 const [phase,setPhase]=useState<Phase>(enabled?'loading':'disabled');
 const [storedProfile,setStoredProfile]=useState<M1StagingSelf|null>(null);
 const [loadedAuthority,setLoadedAuthority]=useState<
  Readonly<{port:MemberProfilePort;revision:number}>|null>(null);
 // React renders may arrive before effect cleanup on an OS Auth switch.
 // Never expose a prior member, even for a one-frame port/epoch mismatch.
 const profile=isM1CurrentProfileAuthority(
  loadedAuthority,port,sessionRevision,enabled)?storedProfile:null;
 const [displayName,setDisplayName]=useState('');
 const [directory,setDirectory]=useState(false);
 const [publicName,setPublicName]=useState(false);
 const [notice,setNotice]=useState('');
 const clearProfile=useCallback(()=>{
  setStoredProfile(null);
  setLoadedAuthority(null);
  setDisplayName('');
  setDirectory(false);
  setPublicName(false);
 },[]);
 const apply=(data:M1StagingSelf)=>{
  setStoredProfile(data);
  setLoadedAuthority({port,revision:sessionRevision});
  setDisplayName(data.display_name??'');
  setDirectory(data.directory_opt_in);
  setPublicName(data.display_name_public);
 };
 const refresh=useCallback(async()=>{
  if(!enabled||busy.current)return;
  busy.current=true;
  const serial=++generation.current;
  // Fail closed before any refresh, including when an Auth owner/port changes.
  // The previous user's name must not remain visible while a new request runs.
  clearProfile();
  setPhase('loading');setNotice('');
  try{
   const value=await port.getSelf();
   if(generation.current===serial){apply(value);setPhase('ready');}
  }catch(error){
   if(generation.current===serial){
    clearProfile();
    setPhase(isM1SessionLost(error)?'reauth_required':'error');
    setNotice(explanation(error));
   }
  }finally{if(generation.current===serial)busy.current=false;}
 },[enabled,port,sessionRevision,clearProfile]);
 useEffect(()=>{
  if(enabled){void refresh();}
  else{
   generation.current++;busy.current=false;
   clearProfile();setNotice('');setPhase('disabled');
  }
  return()=>{generation.current++;busy.current=false;};
 },[enabled,refresh,clearProfile]);
 const save=async()=>{
  if(!enabled||busy.current||!profile||phase!=='ready')return;
  busy.current=true;
  const serial=++generation.current;
  setPhase('saving');setNotice('');
  const payload:M1SelfPatch={
   display_name:displayName.trim()||null,
   directory_opt_in:directory,
   display_name_public:publicName,
  };
  try{
   // The same captured signed Session is checked against the displayed
   // member BEFORE any CAS write. Never write to a newly switched user.
   const updated=await port.patchSelfForUser(profile.s_user_id,profile.profile_revision,payload);
   if(generation.current===serial){apply(updated);setPhase('ready');setNotice('會員資料已儲存。');}
  }catch(error){
   if(generation.current===serial){
    const failure=failedM1SaveScreenState(error);
    // Unknown POST outcome, stale CAS or identity loss: never display the
    // old member's version/privacy toggles as if the write were settled.
    if(!failure.keepDraft)clearProfile();
    setPhase(failure.phase);
    setNotice(failure.notice);
   }
  }finally{if(generation.current===serial)busy.current=false;}
 };
 const logout=async()=>{
  if(!enabled||busy.current||phase!=='ready')return;
  busy.current=true;
  const serial=++generation.current;
  setPhase('logging_out');setNotice('');
  try{
   await port.logout();
   if(generation.current===serial){
    clearProfile();
    setPhase('logged_out');setNotice('目前的登入工作階段已登出。');
   }
  }catch(error){
   if(generation.current===serial){
    // Logout can have succeeded server-side even if the 204 response was lost.
    // Never keep old PII editable or assert logout success from a timeout.
    const failure=failedM1LogoutScreenState(error);
    clearProfile();
    setPhase(failure.phase);
    setNotice(failure.notice);
   }
  }finally{if(generation.current===serial)busy.current=false;}
 };
 const locked=phase!=='ready'||busy.current;
 const button=(label:string,action:()=>void,disabled=false,secondary=false)=>(
  <Pressable accessibilityRole="button" accessibilityLabel={label}
   disabled={disabled} onPress={action}
   style={[styles.button,secondary?styles.secondary:styles.primary,disabled?styles.disabled:null]}>
   <Text style={secondary?styles.secondaryText:styles.primaryText}>{label}</Text>
  </Pressable>
 );
 return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
  <Text style={styles.eyebrow}>STARRY ID · 會員中心</Text>
  <Text accessibilityRole="header" style={styles.heading}>我的會員資料</Text>
  <Text style={styles.description}>此頁只會讀取登入會員本人資料，不支援切換他人帳號或修改會員身分。</Text>
  {preview?<View style={styles.warning}>
   <Text style={styles.warningText}>開發模式｜這是完全離線的示範會員，姓名及設定只保留在此畫面記憶體。並未 Google 登入、連線、建立會員或修改真實資料。</Text>
  </View>:null}
  {!enabled?<View style={styles.warning}>
   <Text style={styles.warningText}>正式登入與會員資料服務尚未開放。需要獨立的安全測試環境與真正的 Google 登入，才能啟用本頁。</Text>
  </View>:null}
  {phase==='loading'||phase==='saving'||phase==='logging_out'?
   <View style={styles.row}><ActivityIndicator accessibilityLabel="處理中"/><Text style={styles.muted}>正在安全處理…</Text></View>:null}
  {notice?<Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>:null}
  {profile&&phase==='ready'?<View style={styles.card}>
   <Text style={styles.section}>個人資料</Text>
   <Text style={styles.label}>公開顯示名稱</Text>
   <TextInput accessibilityLabel="公開顯示名稱"
    style={styles.input} maxLength={80} editable={!locked}
    value={displayName} onChangeText={setDisplayName}
    placeholder="請輸入顯示名稱" autoCapitalize="words"/>
   <View style={styles.switchRow}>
    <Text style={styles.label}>列入公開會員搜尋</Text>
    <Switch accessibilityLabel="列入公開會員搜尋" value={directory} disabled={locked} onValueChange={setDirectory}/>
   </View>
   <View style={styles.switchRow}>
    <Text style={styles.label}>公開顯示名稱</Text>
    <Switch accessibilityLabel="公開顯示名稱開關" value={publicName} disabled={locked} onValueChange={setPublicName}/>
   </View>
   <Text style={styles.muted}>資料版本：{profile.profile_revision}。若其他裝置已修改，請重新讀取後再儲存。</Text>
   {button('儲存會員資料',()=>{void save();},locked)}
   {button('重新讀取會員資料',()=>{void refresh();},locked,true)}
   {button('登出目前的工作階段',()=>{void logout();},locked,true)}
  </View>:null}
  {enabled&&(phase==='error'||phase==='logged_out'||phase==='reauth_required')?
   <View style={styles.card}>
    <Text style={styles.muted}>{phase==='logged_out'?'已登出，請透過正式登入流程重新登入。':
     phase==='reauth_required'?'登入狀態失效，私人資料已從畫面清除。請重新登入。':'無法取得會員資料。'}</Text>
    {phase==='error'?button('重新讀取',()=>{void refresh();},false,true):null}
   </View>:null}
  {preview&&previewTools&&phase==='ready'?<View style={styles.previewPanel}>
   <Text style={styles.section}>開發模式測試</Text>
   <Text style={styles.muted}>以下只模擬本機操作，不會連到伺服器。設定後會影響下一次指定操作。</Text>
   {button('模擬資料衝突（再按儲存）',()=>{
    previewTools.failNext('CONFLICT');setNotice('下一次儲存會模擬其他裝置先修改資料。');
   },locked,true)}
   {button('模擬下次重新讀取失敗',()=>{
    previewTools.failNext('UNAVAILABLE');void refresh();
   },locked,true)}
   {button('模擬登入失效並清除畫面',()=>{
    previewTools.failNext('UNAUTHORIZED');void refresh();
   },locked,true)}
  </View>:null}
  <Text style={styles.footer}>本頁不包含金流、管理員權限、刪帳執行或公開會員搜尋。服務未開放時不會取得任何身分憑證。</Text>
 </ScrollView>;
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F6F8FC'},
 content:{padding:20,paddingBottom:60,gap:17,maxWidth:540,width:'100%',alignSelf:'center'},
 eyebrow:{fontSize:12,fontWeight:'700',letterSpacing:1.3,color:'#526780'},
 heading:{fontSize:28,fontWeight:'800',color:'#162F4F'},
 description:{fontSize:15,lineHeight:24,color:'#334963'},
 warning:{padding:16,borderRadius:12,backgroundColor:'#FFF2D8'},
 warningText:{fontSize:14,lineHeight:22,color:'#60450F'},
 card:{padding:18,borderWidth:1,borderColor:'#E1E8F0',borderRadius:16,backgroundColor:'#FFFFFF',gap:14},
 section:{fontSize:19,fontWeight:'800',color:'#1E3654'},
 label:{fontSize:15,fontWeight:'600',color:'#294361',flexShrink:1},
 muted:{fontSize:13,lineHeight:21,color:'#526780'},
 row:{flexDirection:'row',alignItems:'center',gap:12},
 switchRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:16,minHeight:46},
 input:{minHeight:48,padding:12,borderWidth:1,borderColor:'#B9C9DD',borderRadius:9,fontSize:16,color:'#162F4F'},
 button:{minHeight:48,paddingVertical:13,paddingHorizontal:14,borderRadius:11,alignItems:'center',justifyContent:'center'},
 primary:{backgroundColor:'#19598E'},
 secondary:{backgroundColor:'#E7F0F9'},
 disabled:{opacity:0.45},
 primaryText:{color:'#FFFFFF',fontSize:15,fontWeight:'700',textAlign:'center'},
 secondaryText:{color:'#1D527C',fontSize:15,fontWeight:'700',textAlign:'center'},
 notice:{fontSize:14,lineHeight:22,color:'#7E500D'},
 previewPanel:{padding:16,borderWidth:1,borderStyle:'dashed',
  borderColor:'#B7C6D9',borderRadius:12,gap:12},
 footer:{fontSize:13,lineHeight:21,color:'#526780'},
});
