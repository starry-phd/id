import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
export default function Home(){return <View style={styles.container}><Text style={styles.title}>Starry ID</Text><Text>開發基座 · 尚未連接會員或正式服務</Text><Link href="/about">About this build</Link></View>}
const styles=StyleSheet.create({container:{flex:1,justifyContent:'center',alignItems:'center',gap:16,padding:24},title:{fontSize:28,fontWeight:'700'}});
