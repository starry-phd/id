import {Link} from 'expo-router';
import {Text,View} from 'react-native';
import {offlineMemberView} from '../../src/member-service';

export default function MemberProfile(){
 return <View style={{padding:24,gap:16}}>
  <Text style={{fontSize:22,fontWeight:'700'}}>Starry ID｜個人資料</Text>
  <Text>{offlineMemberView.message}</Text>
  <Text>此畫面不要求或儲存測試 Token，也不展示假會員資料。</Text>
  <Link href="/member">返回會員入口</Link>
 </View>;
}
