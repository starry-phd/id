import {Link} from 'expo-router';
import {Text, View} from 'react-native';
export default function Home() {
  return <View style={{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:16}}>
    <Text>Starry ID · development-only foundation</Text>
    <Text>目前僅有 API 健康檢查；會員登入、Session、個資讀寫與正式服務尚未開放。</Text>
    <Link href="/about">檢視開發階段限制</Link>
  </View>;
}
