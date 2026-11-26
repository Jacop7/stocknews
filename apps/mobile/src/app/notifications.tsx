import {Link} from 'expo-router';
import {Pressable,StyleSheet,Text} from 'react-native';
import {Screen,s} from '../components/Screen';
import {SettingsHeader} from '../components/SettingsHeader';
import {useInstallation} from '../data/InstallationContext';
export default function Notifications(){const i=useInstallation(),items=i.state.notifications??[];return <Screen title='알림' header={<SettingsHeader title='알림' settings/>}>
 <Text style={s.body}>실제 푸시 발송 미연결 · 개발 환경</Text>{i.busy&&<Text style={s.body}>알림 확인 중…</Text>}{Boolean(i.error)&&<Text style={s.body}>알림 내역을 확인할 수 없습니다.</Text>}
 {!i.busy&&!items.length&&<Text style={[s.body,{marginTop:35}]}>받은 알림이 없습니다.</Text>}
 {items.map(x=><Link key={x.id} href={'/article/'+x.issue_id as any} asChild><Pressable style={s.card}><Text style={s.headline}>{x.notification_type==='MORNING'?'오전 장 이슈':x.notification_type==='CLOSING'?'장 마감 이슈':'관심 섹터 이슈'}</Text><Text style={s.date}>{new Date(x.cutoff).toLocaleString('ko-KR')}</Text></Pressable></Link>)}
 <Link href='/notification-settings' style={StyleSheet.flatten([s.badge,{marginTop:28}])}>알림 설정</Link></Screen>;}
