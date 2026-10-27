import {Link,useLocalSearchParams} from 'expo-router';
import {ScrollView,Text,Pressable,View} from 'react-native';
import {getDemoTrack} from '../../src/catalog';
import {s} from '../../src/theme';
export default function TrackDetail(){
 const p=useLocalSearchParams<{id:string}>();
 const t=getDemoTrack(Array.isArray(p.id)?p.id[0]:p.id);
 if(!t)return <View style={[s.page,s.scroll]}><Text style={s.heading}>查無示範音檔</Text>
  <Text style={s.body}>沒有取得真實音檔，也不會嘗試存取會員資料。</Text>
  <Link href="/" asChild><Pressable><Text style={s.smallLink}>返回首頁</Text></Pressable></Link></View>;
 return <ScrollView style={s.page} contentContainerStyle={s.scroll}>
  <Text style={s.kicker}>{t.category}</Text>
  <Text style={s.heading}>{t.title}</Text>
  <Text style={s.intro}>{t.speaker} · {Math.floor(t.durationSeconds/60)} 分鐘（示意）</Text>
  <View style={s.card}><Text style={s.title}>音檔介紹</Text>
   <Text style={s.body}>{t.description}</Text></View>
  <Link href={{pathname:'/player/[id]',params:{id:t.id}}} asChild>
   <Pressable style={s.action} accessibilityRole="button"><Text style={s.actionText}>開啟播放器介面</Text></Pressable>
  </Link>
  <View style={s.warning}><Text style={s.warningText}>目前沒有授權音檔，不能實際播放、離線下載、扣電池或進行任何帳號操作。</Text></View>
 </ScrollView>;
}