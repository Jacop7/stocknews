import {Link} from 'expo-router';
import {Linking,Pressable,Text,View} from 'react-native';
import Constants from 'expo-constants';
import {useState} from 'react';
import {Screen,s} from '../components/Screen';
import {SettingsHeader} from '../components/SettingsHeader';
import {useInstallation} from '../data/InstallationContext';
export default function Settings(){
 const i=useInstallation(),[confirm,setConfirm]=useState<'disconnect'|'recover'|'new'|null>(null),[mailError,setMailError]=useState('');
 const execute=async()=>{const which=confirm;setConfirm(null);if(which==='disconnect')await i.disconnect();if(which==='recover')await i.recover();if(which==='new')await i.newConnection();};
 const linked=Boolean(i.state.settings),recovery=/UNKNOWN|RECOVERY|DISPATCHED/.test(i.state.state);
 return <Screen title='설정' header={<SettingsHeader title='설정'/>}>
 {[['알림 설정','/notification-settings'],['이용약관','/legal?kind=terms'],['개인정보처리방침 및 광고 안내','/legal?kind=privacy']].map(([label,href])=><Link key={label} href={href as any} asChild><Pressable style={{...s.card,flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontSize:16,color:'#171724'}}>{label}</Text><Text style={s.body}>›</Text></Pressable></Link>)}
 <View style={{...s.card,flexDirection:'row',justifyContent:'space-between'}}><Text style={s.body}>앱 버전</Text><Text style={s.body}>{Constants.expoConfig?.version??'버전 확인 중'} · 개발 환경</Text></View>
 <Pressable style={s.card} accessibilityLabel='문의 이메일 callamelo@naver.com' onPress={()=>{setMailError('');void Linking.openURL('mailto:callamelo@naver.com').catch(()=>setMailError('메일 앱을 열 수 없습니다. callamelo@naver.com으로 문의해 주세요.'));}}><Text style={{fontSize:16,color:'#171724'}}>문의</Text><Text style={s.body}>callamelo@naver.com</Text></Pressable>{Boolean(mailError)&&<Text accessibilityRole='alert' style={s.body}>{mailError}</Text>}
 <View style={{marginTop:26,gap:14}}><Text style={s.badge}>이 기기 서버 연결 · 개발용</Text><Text style={s.body}>{linked?'알림 선호를 이 설치에 연결했습니다. 실제 푸시 발송은 연결되지 않았습니다.':'서버 설정 연결을 확인해 주세요. 뉴스 읽기와 기기 저장은 독립적으로 사용할 수 있습니다.'}</Text>
 {i.busy&&<Text style={s.body}>연결 상태 확인 중…</Text>}{Boolean(i.error)&&<Text accessibilityRole='alert' style={s.body}>연결을 확인하지 못했습니다. ({i.error})</Text>}
 <Pressable disabled={i.busy} onPress={()=>void i.refresh()}><Text style={s.badge}>연결 상태 다시 확인</Text></Pressable>
 {linked&&<><Pressable disabled={i.busy} onPress={()=>void i.rotate()}><Text style={s.badge}>연결 정보 갱신</Text></Pressable><Pressable disabled={i.busy} onPress={()=>setConfirm('disconnect')}><Text style={s.body}>이 기기 서버 연결 해제</Text></Pressable></>}
 {recovery&&<Pressable disabled={i.busy} onPress={()=>setConfirm('recover')}><Text style={s.badge}>미확정 연결 복구 확인</Text></Pressable>}
 {!linked&&!recovery&&<Pressable disabled={i.busy} onPress={()=>setConfirm('new')}><Text style={s.badge}>새 연결 · 알림 기본값으로 시작</Text></Pressable>}
 {confirm&&<View style={{borderWidth:1,borderColor:'#e8e8ee',borderRadius:12,padding:18,gap:12}}><Text style={{fontSize:16,fontWeight:'600'}}>연결 변경 확인</Text><Text style={s.body}>{confirm==='disconnect'?'이 설치의 서버 연결과 알림 선호를 해제합니다. 기기에 저장한 글은 유지합니다. 개인정보 전체 삭제가 아니며 합성 조회 기록은 정해진 보관 기간 후 삭제됩니다.':confirm==='recover'?'이전 처리가 끝났는지 서버에 확인합니다. 복구가 불가능하고 서버 기한이 지난 경우 이전 연결을 포기할 수 있습니다. 이전 설정을 복구하지 못할 수 있으며 서버 데이터 삭제가 아닙니다.':'새 설치 연결과 알림 기본값으로 시작합니다. 이전 설정은 복원하지 않으며 이전 서버 데이터 삭제가 아닙니다. 복구되지 않은 이전 설치는 개발용 최대24시간 수명에 따라 만료됩니다. 기기에 저장한 글은 유지합니다.'}</Text><View style={s.row}><Pressable style={s.chip} onPress={()=>setConfirm(null)}><Text style={s.chipText}>취소</Text></Pressable><Pressable style={s.chip} onPress={()=>void execute()}><Text style={[s.chipText,{color:'#4f46e5'}]}>확인하고 진행</Text></Pressable></View></View>}
 </View></Screen>;
}
