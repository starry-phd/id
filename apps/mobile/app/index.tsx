import {Link} from 'expo-router';
import {Text, View} from 'react-native';
export default function Home() {
  return <View style={{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:16}}>
    <Text>Starry ID · development-only foundation</Text>
    <Text>正式登入與會員刪帳服務尚未開放。您可以在開發模式體驗不連線的刪帳申請介面。</Text>
    <Link href="/account-deletion">體驗刪帳申請流程（僅本機預覽）</Link>
    <Link href="/about">檢視開發階段限制</Link>
  </View>;
}
