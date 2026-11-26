import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Link,useLocalSearchParams} from 'expo-router';
import type {PublicCatalog,PublicCompanyPage} from '@judoju/contracts';
import {Screen,s} from '../../components/Screen';
import {NewsCard} from '../../components/NewsCard';
import {useCurrentRead} from '../../data/useCurrentRead';
// Company page (2026-11-27). Company issues (one company's own filing, financing, capacity...) live here only;
// sector issues that link this company with a stated role are listed here as well.
export default function Company(){
 const {id}=useLocalSearchParams<{id:string}>(),[cursor,setCursor]=useState(''),[cursorContext,setCursorContext]=useState('');
 const catalog=useCurrentRead<PublicCatalog>('/v2/catalog',0,0),[knownVersion,setKnownVersion]=useState('');
 useEffect(()=>{if(catalog.data)setKnownVersion(catalog.data.catalog_version);},[catalog.data?.catalog_version]);
 const head=catalog.data?.catalog_version??knownVersion,context=head+'|'+id,currentCursor=context===cursorContext?cursor:'';
 const path=head&&id?`/v2/companies/${encodeURIComponent(id)}?version=${head}&limit=20`+(currentCursor?'&cursor='+encodeURIComponent(currentCursor):''):null;
 const result=useCurrentRead<PublicCompanyPage>(path,0,0),page=result.data;
 const reset=()=>{setCursor('');setCursorContext('');catalog.retry();result.retry();};
 return <Screen title='종목'><Link href='/'>‹ 홈으로</Link>
  {(result.loading||catalog.loading)&&<Text style={s.body}>종목 확인 중…</Text>}
  {Boolean(result.error||catalog.error)&&<View><Text accessibilityRole='alert' style={s.body}>{result.error||catalog.error}</Text><Pressable onPress={reset}><Text style={s.badge}>{result.status===409?'최신 분류로 처음부터':'다시 확인'}</Text></Pressable></View>}
  {page?.state==='NOT_FOUND'&&<Text style={s.body}>현재 제공하지 않는 종목입니다.</Text>}
  {page?.state==='AVAILABLE'&&<>
   <Text style={[s.title,{marginTop:22}]}>{page.company.name}</Text>
   <Text style={s.body}>{page.company.search_description}</Text>
   <Text style={[s.date,{marginTop:6}]}>시세 · 종목 코드 확인 전</Text>
   {page.company.related_sectors.length>0&&<View style={{marginTop:20}}><Text style={{fontSize:13,fontWeight:'600',color:'#555563',marginBottom:10}}>관련 섹터</Text>
    <View style={s.row}>{page.company.related_sectors.map(x=><Link key={x.id} href={{pathname:'/sector/[id]',params:{id:x.id,tab:'stocks'}}} asChild><Pressable style={s.chip}><Text style={s.chipText}>{x.name}</Text></Pressable></Link>)}</View></View>}
   <View style={{borderTopWidth:1,borderTopColor:'#e8e8ee',marginTop:24,paddingTop:22}}><Text style={{fontSize:13,fontWeight:'600',color:'#555563',marginBottom:6}}>이슈체크</Text>
    <Text style={[s.date,{marginBottom:14}]}>이 종목의 공시·발표 분석과, 이 종목이 연결된 섹터 이슈</Text>
    {page.items.length===0&&<Text style={s.body}>아직 이 종목과 연결된 이슈가 없습니다.</Text>}
    {page.items.map(n=><View key={n.issue_id}><Text style={[s.date,{marginBottom:4}]}>{n.company_role==='PRIMARY'?'종목 이슈':'섹터 이슈 · 관련 기업으로 언급'}</Text><NewsCard article={n}/></View>)}
    <View style={[s.row,{marginTop:18}]}>{Boolean(currentCursor)&&<Pressable style={s.chip} onPress={()=>setCursor('')}><Text style={s.chipText}>처음</Text></Pressable>}{page.next_cursor&&<Pressable style={s.chip} onPress={()=>{setCursor(page.next_cursor!);setCursorContext(context);}}><Text style={s.chipText}>이슈 더보기</Text></Pressable>}</View>
   </View>
  </>}
 </Screen>;
}
