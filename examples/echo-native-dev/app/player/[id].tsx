import {Link,useLocalSearchParams} from 'expo-router';
import {ScrollView,Text,Pressable,View} from 'react-native';
import {getDemoTrack,playbackGate} from '../../src/catalog';
import {s} from '../../src/theme';
export default function Player(){
 const {id}=useLocalSearchParams<{id:string}>();
 const t=getDemoTrack(Array.isArray(id)?id[0]:id),state=playbackGate(t);
 return <ScrollView style={s.page} contentContainerStyle={s.scroll}>
  <Text style={s.kicker}>原生播放器 · DEV</Text>
  <Text style={s.heading}>{t?.title??'找不到音檔'}</Text>
  <Text style={s.intro}>{t?.speaker??'不明講者'}</Text>
  <View style={s.card}><Text style={s.title}>播放狀態</Text>
   <Text style={s.body}>無授權音源｜未開始播放</Text>
   <Pressable style={s.disabled} disabled={!state.canPlay} accessibilityRole="button"
    accessibilityState={{disabled:true}}><Text style={s.disabledText}>播放（未提供音源）</Text></Pressable>
   <Pressable style={s.disabled} disabled={!state.canDownload} accessibilityRole="button"
    accessibilityState={{disabled:true}}><Text style={s.disabledText}>離線下載（未開通）</Text></Pressable>
  </View>
  <View style={s.warning}><Text style={s.warningText}>
   需先確認音檔使用權及 API 身分驗證；真正背景播放、鎖屏和下載仍待 Expo Audio / FileSystem 與真機驗收。
  </Text></View>
  <Link href="/" asChild><Pressable><Text style={s.smallLink}>返回音檔清單</Text></Pressable></Link>
 </ScrollView>;
}