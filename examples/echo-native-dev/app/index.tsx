import {useMemo,useState} from 'react';
import {Link} from 'expo-router';
import {ScrollView,Text,TextInput,View,Pressable} from 'react-native';
import {listDemoTracks} from '../src/catalog';
import {s} from '../src/theme';
export default function EchoHome(){
 const [query,setQuery]=useState('');
 const tracks=useMemo(()=>listDemoTracks(query),[query]);
 return <ScrollView style={s.page} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
  <Text style={s.kicker}>ECHO STARRY · OFFLINE DEV</Text>
  <Text style={s.heading}>讓每一段聲音，都值得被聽見。</Text>
  <Text style={s.intro}>這是繁星回聲全新 Expo App 的可執行介面展示。所有音檔標題都是虛構示例，尚未連接正式服務。</Text>
  <TextInput accessibilityLabel="搜尋示範音檔" placeholder="搜尋標題、講者或類別"
   value={query} onChangeText={setQuery} style={s.input} autoCapitalize="none"/>
  <Text style={s.tag}>示範音檔 · {tracks.length} 筆</Text>
  {tracks.map(t=><Link key={t.id} href={{pathname:'/track/[id]',params:{id:t.id}}} asChild>
   <Pressable style={s.card} accessibilityRole="button"
    accessibilityLabel={'查看'+t.title}>
    <Text style={s.tag}>{t.category} · {Math.floor(t.durationSeconds/60)} 分鐘</Text>
    <Text style={s.title}>{t.title}</Text>
    <Text style={s.body}>{t.speaker}</Text>
   </Pressable>
  </Link>)}
  {tracks.length===0&&<View style={s.card}><Text style={s.body}>找不到符合條件的示範音檔。</Text></View>}
  <Link href="/about" asChild><Pressable accessibilityRole="button"><Text style={s.smallLink}>查看功能限制與上線條件</Text></Pressable></Link>
 </ScrollView>;
}