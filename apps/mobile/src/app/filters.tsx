import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen,s } from '../components/Screen';
export default function Page() {return <Screen title='필터'><Link href='/'>‹ 홈으로</Link><Text style={[s.title,{marginTop:24}]}>필터</Text><Text style={s.body}>섹터와 하위 섹터를 하나의 화면에서 선택하는 흐름을 연결할 예정입니다.</Text></Screen>;}
