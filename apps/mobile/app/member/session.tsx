import { Link } from 'expo-router';
import { Text, View } from 'react-native';
export default function SessionPlaceholder(){return <View style={{padding:24,gap:16}}><Text>Starry Session／授權：尚未提供任何有效憑證或會員權限。</Text><Link href="/member">返回會員入口</Link></View>}
