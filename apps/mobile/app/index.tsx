import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function Home() {
  return <View style={styles.main}>
    <Text style={styles.heading}>Starry ID · Phase 0</Text>
    <Text>Starry 生態系獨立會員服務的開發基座，尚未開通帳號、登入或個資讀寫。</Text>
    <Link href="/member">Starry ID 會員入口（開發中）</Link>
    <Link href="/about">查看開發限制</Link>
  </View>;
}
const styles = StyleSheet.create({main:{flex:1,justifyContent:'center',alignItems:'center',gap:20,padding:24},heading:{fontSize:26,fontWeight:'700'}});
