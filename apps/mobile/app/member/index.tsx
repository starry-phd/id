import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { STARRY_ID_TEMPLATE } from '../../src/brand-registry';

export default function MemberEntry() {
  return <View style={styles.main}>
    <Text style={styles.heading}>Starry ID 會員入口</Text>
    <Text>品牌：{STARRY_ID_TEMPLATE.brandId}｜服務：{STARRY_ID_TEMPLATE.appId}</Text>
    <Text>目前只有路由及畫面佔位，沒有 OAuth、真實會員資料或 Session。</Text>
    <Link href="/member/sign-in">登入入口規劃</Link>
    <Link href="/member/profile">個人檔案入口規劃</Link>
    <Link href="/member/session">Session 入口規劃</Link>
    <Link href="/">返回首頁</Link>
  </View>;
}
const styles=StyleSheet.create({main:{flex:1,padding:24,justifyContent:'center',gap:16},heading:{fontWeight:'700',fontSize:24}});
