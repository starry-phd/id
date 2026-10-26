import { Link } from 'expo-router';
import { Text, View } from 'react-native';
export default function ProfilePlaceholder(){return <View style={{padding:24,gap:16}}><Text>Starry 會員個人檔案：尚未接入 Auth/API/D1，未讀取任何會員資料。</Text><Link href="/member">返回會員入口</Link></View>}
