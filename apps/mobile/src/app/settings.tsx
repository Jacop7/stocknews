import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen,s } from '../components/Screen';
export default function Page() {return <Screen title='설정'><Link href='/'>‹ 홈으로</Link><Text style={[s.title,{marginTop:24}]}>설정</Text><Text style={s.body}>알림 설정 · 이용약관 · 개인정보처리방침 · 앱 버전 · 문의 항목을 제공합니다.</Text></Screen>;}
