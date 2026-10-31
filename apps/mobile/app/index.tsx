import {Link} from 'expo-router';
import {Text, View} from 'react-native';
export default function Home() {
  return <View style={{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:16}}>
    <Text>Starry ID · development-only foundation</Text>
    <Text>正式 Google 登入與會員服務尚未開放。開發模式可體驗完全離線的會員資料編輯和刪帳申請流程，所有示範資料均非真實會員。</Text>
    <Link href="/profile">操作會員資料（僅開發模式離線演示）</Link>
    <Link href="/account-deletion">體驗刪帳申請流程（僅本機預覽）</Link>
    <Link href="/about">檢視開發階段限制</Link>
  </View>;
}
