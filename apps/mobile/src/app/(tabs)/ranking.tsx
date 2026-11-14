import { Text } from 'react-native';
import { Screen,s } from '../../components/Screen';
export default function Page() { return <Screen title='섹터랭킹' saved={false}><Text style={s.title}>섹터랭킹</Text><Text style={s.body}>검증한 시세와 섹터 구성 종목을 연결한 뒤 등락률을 표시합니다.</Text></Screen>; }
