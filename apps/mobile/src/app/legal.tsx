import {useLocalSearchParams} from 'expo-router';
import {Text,View} from 'react-native';
import {Screen,s} from '../components/Screen';
import {SettingsHeader} from '../components/SettingsHeader';
export default function Legal(){const {kind}=useLocalSearchParams<{kind:string}>(),privacy=kind!=='terms',title=privacy?'개인정보처리방침 및 광고 안내':'이용약관';
 const sections=privacy?[
 ['현재 제공 범위','로그인 없이 사용하는 주도주뉴스의 개발 초안입니다. 현재는 합성 기사와 QA 통계로 검증하며 실제 광고 요청·푸시 발송·운영 분석을 활성화하지 않았습니다.'],
 ['이 기기에 저장하는 정보','저장한 글의 식별자와 저장 시각은 이 기기에 보관합니다. 네이티브 서버 연결 정보는 보안 저장소, 웹은 HttpOnly 쿠키에 별도로 보관합니다. 브라우저 또는 앱 데이터를 지우면 기기 저장 글을 복구할 수 없습니다.'],
 ['개발 서버에 보관하는 정보','설치별 익명 연결 정보와 세 가지 알림 선호, 관심 섹터 및 합성 조회 기록을 사용합니다. 원시 QA 조회는 수락 시각부터30일, 일별 합성 집계는1년을 초기 상한으로 검증합니다. 설정 변경 이력은30일입니다. 이것은 확정된 운영 보관 정책이 아닙니다.'],
 ['연결 해제와 삭제의 구분','서버 연결 해제는 연결 권한 폐기와 알림 선호 초기화입니다. 기기에 저장한 글은 유지하며 개인정보 전체 삭제나 백업 소거 완료를 뜻하지 않습니다. 실제 운영 삭제 기능과 백업 정책은 출시 전에 확정합니다.'],
 ['광고·추적·알림','광고 및 알림 관련 네이티브 SDK가 포함될 수 있으나 현재 실제 광고 요청·푸시 토큰 등록·발송은 연결하지 않았습니다. 출시 국가와 맞춤형 광고·추적 방식에 따른 동의, OS 권한, 스토어 공개 항목은 별도 출시 검수 대상입니다.'],
 ['미확정 항목과 문의','사업자 정보, 출시 국가, 법적 처리 근거, 수탁자·이전 국가, 운영 보관 기간과 권리 행사 절차는 미확정입니다. 문의: callamelo@naver.com. 법률 검수와 스토어 등록이 끝난 최종 정책으로 사용하지 않습니다.']
 ]:[['서비스 범위','주도주뉴스는 한국 주식시장과 관련된 뉴스·섹터 이슈를 정리하는 서비스입니다. 현재 화면은 개발용 합성 자료이며 실시간 뉴스·시세가 아닙니다.'],['정보 이용','분석과 시나리오는 불확실성을 포함하며 수익을 보장하지 않습니다. 운영 게시 전 원문·발표 시점·근거와 정정 상태를 검증합니다.'],['기기 저장과 서버 연결','계정 로그인과 기기간 동기화를 제공하지 않습니다. 저장 글은 이 기기에서 관리하며 서버 연결을 해제해도 유지합니다. 알림 선호와 실제 OS 권한·발송 가능 상태는 구분합니다.'],['미확정 운영 항목','사업자 정보, 최종 이용 조건, 책임 범위, 분쟁 처리·변경 통지 절차는 출시 전 확정과 검수가 필요합니다. 문의: callamelo@naver.com.']];
 return <Screen title={title} header={<SettingsHeader title={title}/>}><Text style={s.badge}>개발 초안 · 최종 약관/정책 아님</Text>{sections.map(([heading,body])=><View key={heading} style={{marginBottom:26}}><Text style={{fontSize:16,fontWeight:'600',color:'#171724',marginBottom:10}}>{heading}</Text><Text style={s.body}>{body}</Text></View>)}</Screen>;
}
