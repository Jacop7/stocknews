import { Text } from 'react-native';
import { Screen,s } from '../../components/Screen';
export default function Page() { return <Screen title='저장' saved={true}><Text style={s.title}>저장</Text><Text style={s.body}>저장한 기사 목록이 표시되는 화면입니다. 저장 기능과 설치 소유권은 후속 단계에서 연결합니다.</Text></Screen>; }
