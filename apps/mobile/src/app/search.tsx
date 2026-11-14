import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen,s } from '../components/Screen';
export default function Page() {return <Screen title='검색'><Link href='/'>‹ 홈으로</Link><Text style={[s.title,{marginTop:24}]}>검색</Text><Text style={s.body}>뉴스 / 종목 검색은 데이터 연결 후 제공됩니다.</Text></Screen>;}
