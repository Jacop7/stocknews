import { Link,useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Screen,s } from '../../components/Screen';
export default function Article(){const {id}=useLocalSearchParams();return <Screen title='이슈체크 상세'><Link href='/'>‹ 홈으로</Link><Text style={[s.title,{marginTop:24}]}>기사 상세 연결 대기</Text><Text style={s.body}>샘플 ID: {id}. 핵심 이슈·한국 섹터 영향·근거에 따른 조건부 영역은 후속 단계에서 구현합니다.</Text></Screen>;}
