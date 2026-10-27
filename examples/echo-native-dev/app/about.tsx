import {ScrollView,Text,View} from 'react-native';
import {s} from '../src/theme';
export default function About(){
 return <ScrollView style={s.page} contentContainerStyle={s.scroll}>
  <Text style={s.kicker}>開發樣板 · 僅本地測試</Text>
  <Text style={s.heading}>繁星回聲</Text>
  <Text style={s.intro}>這是真正的 React Native/Expo Router 畫面原始碼，不是 WebView，但不代表已可正式上架。</Text>
  <View style={s.card}><Text style={s.title}>目前可演示</Text>
   <Text style={s.body}>音檔首頁、假資料搜尋、音檔詳情、播放器操作入口與錯誤狀態。</Text></View>
  <View style={s.card}><Text style={s.title}>目前尚未開通</Text>
   <Text style={s.body}>真實音檔播放、登入、會員與資料庫、AI 逐字稿、電池扣款、付費、Store/EAS、Cloudflare 部署。</Text></View>
  <View style={s.warning}><Text style={s.warningText}>正式 G00～G10 11 項 Gate 仍封鎖；免費 Battery 永久不能販售。不要以此 DEV 專案建立官方產品識別碼。</Text></View>
 </ScrollView>;
}