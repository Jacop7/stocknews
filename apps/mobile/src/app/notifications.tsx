import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen,s } from '../components/Screen';
export default function Page() {return <Screen title='알림'><Link href='/'>‹ 홈으로</Link><Text style={[s.title,{marginTop:24}]}>알림</Text><Text style={s.body}>오전 장 이슈 · 장 마감 이슈 · 관심 섹터 이슈 알림을 관리합니다.</Text></Screen>;}
