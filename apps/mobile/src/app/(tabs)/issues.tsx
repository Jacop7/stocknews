import { Text } from 'react-native';
import { Screen,s } from '../../components/Screen';
export default function Page() { return <Screen title='이슈체크' saved={false}><Text style={s.title}>이슈체크</Text><Text style={s.body}>섹터별 이슈와 관련 종목을 확인하는 화면입니다. 수집·게시 API 연결은 후속 단계에서 구현합니다.</Text></Screen>; }
