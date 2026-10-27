import {Stack} from 'expo-router';
import {c} from '../src/theme';
export default function Layout(){
 return <Stack screenOptions={{headerStyle:{backgroundColor:c.paper},headerTintColor:c.ink,
  headerTitleStyle:{fontWeight:'700'}}}>
  <Stack.Screen name="index" options={{title:'繁星回聲 · 開發展示'}}/>
  <Stack.Screen name="track/[id]" options={{title:'音檔詳情'}}/>
  <Stack.Screen name="player/[id]" options={{title:'播放器'}}/>
  <Stack.Screen name="about" options={{title:'開發說明'}}/>
 </Stack>;
}