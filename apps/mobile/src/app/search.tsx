import {useEffect,useState} from 'react';
import {Link,router} from 'expo-router';
import {Modal,Pressable,Text,TextInput,View,ScrollView} from 'react-native';
import type {PublicCatalog,SearchCompany,SearchCompanyPage,SearchNewsPage,CompanySectorPage} from '@judoju/contracts';
import {Screen,s} from '../components/Screen';
import {NewsCard} from '../components/NewsCard';
import {useCurrentRead} from '../data/useCurrentRead';
type SelectedCompany={source_company_ref:string;name:string};
function CompanyRow({company:c,onMore}:{company:SearchCompany;onMore:(company:SelectedCompany)=>void}){
 return <View style={s.card}><Link href={{pathname:'/company/[id]',params:{id:c.source_company_ref}}} asChild><Pressable accessibilityRole='link'><Text style={s.headline}>{c.name} ›</Text><Text style={s.body}>{c.search_description}</Text></Pressable></Link><Text style={[s.date,{marginBottom:12}]}>시세 · 종목 코드 확인 전</Text><View style={s.row}>{c.related_sectors.map(x=><Link key={x.id} href={{pathname:'/sector/[id]',params:{id:x.id,tab:'stocks'}}} asChild><Pressable style={s.chip}><Text style={s.chipText}>{x.name}</Text></Pressable></Link>)}{c.has_more_sectors&&<Pressable style={s.chip} onPress={()=>onMore(c)}><Text style={s.chipText}>관련 섹터 더보기</Text></Pressable>}</View></View>;
}
function CompanySectorModal({company,version,onClose,onRefresh}:{company:SelectedCompany|null;version:string;onClose:()=>void;onRefresh:()=>void}){
 const [offset,setOffset]=useState(0);useEffect(()=>setOffset(0),[company?.source_company_ref,version]);
 const sectors=useCurrentRead<CompanySectorPage>(company&&version?`/v2/companies/${company.source_company_ref}/sectors?version=${version}&offset=${offset}&limit=20`:null);
 return <Modal visible={Boolean(company)} transparent animationType='slide' onRequestClose={onClose}><View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0005'}}><View style={{maxHeight:'85%',backgroundColor:'#fff',borderTopLeftRadius:20,borderTopRightRadius:20,padding:22}}><Text style={s.headline}>{company?.name} 관련 섹터</Text><ScrollView>{sectors.loading&&<Text style={s.body}>확인 중…</Text>}{Boolean(sectors.error)&&<View><Text style={s.body}>{sectors.error}</Text><Pressable onPress={()=>{if(sectors.status===409)onRefresh();sectors.retry();}}><Text style={s.badge}>다시 확인</Text></Pressable></View>}{sectors.data?.state==='NOT_FOUND'&&<Text style={s.body}>현재 제공하지 않는 기업입니다.</Text>}{sectors.data&&<View style={s.row}>{sectors.data.items.map(x=><Link key={x.id} href={{pathname:'/sector/[id]',params:{id:x.id,tab:'stocks'}}} asChild><Pressable style={s.chip} onPress={onClose}><Text style={s.chipText}>{x.name}</Text></Pressable></Link>)}</View>}<View style={s.row}>{offset>0&&<Pressable style={s.chip} onPress={()=>setOffset(0)}><Text style={s.chipText}>처음</Text></Pressable>}{sectors.data?.next_offset!=null&&<Pressable style={s.chip} onPress={()=>setOffset(sectors.data!.next_offset!)}><Text style={s.chipText}>다음 섹터</Text></Pressable>}</View></ScrollView><Pressable style={s.chip} onPress={onClose}><Text style={s.chipText}>닫기</Text></Pressable></View></View></Modal>;
}
export default function Search(){
 const [query,setQuery]=useState(''),[tab,setTab]=useState<'news'|'companies'>('news'),[cursor,setCursor]=useState(''),[cursorContext,setCursorContext]=useState('');
 const [selectedCompany,setSelectedCompany]=useState<SelectedCompany|null>(null);
 const catalog=useCurrentRead<PublicCatalog>('/v2/catalog',0,0),[knownVersion,setKnownVersion]=useState('');
 useEffect(()=>{if(catalog.data)setKnownVersion(catalog.data.catalog_version);},[catalog.data?.catalog_version]);
 const head=catalog.data?.catalog_version??knownVersion;
 const normalized=query.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase(),valid=Boolean(normalized)&&[...query].length<=80&&normalized.split(' ').length<=6&&!/[\u0000-\u001f\u007f]/u.test(normalized);
 const context=head+'|'+tab+'|'+normalized,currentCursor=context===cursorContext?cursor:'';
 const path=valid&&head&&catalog.data?`/v2/search/${tab}?version=${head}&q=${encodeURIComponent(normalized)}&limit=20`+(currentCursor?'&cursor='+encodeURIComponent(currentCursor):''):null;
 const result=useCurrentRead<SearchNewsPage|SearchCompanyPage>(path,400,0);
 const rateLimited=catalog.status===429||result.status===429;
 const retryRate=()=>{if(catalog.status===429)catalog.retry();if(result.status===429)result.retry();};
 const reset=()=>{setCursor('');setCursorContext('');catalog.retry();result.retry();};
 return <Screen title='검색' header={<View style={{flex:1,flexDirection:'row',alignItems:'center',gap:14}}><View style={{flex:1,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#e8e8ee',borderRadius:14,paddingHorizontal:12}}><Text style={s.action}>⌕</Text><TextInput autoFocus accessibilityLabel='뉴스·종목 검색어' placeholder='뉴스·종목 검색' value={query} onChangeText={text=>{setQuery(text);setSelectedCompany(null);}} style={{flex:1,paddingVertical:12,paddingHorizontal:10,fontSize:16,color:'#1a1a2e'}} returnKeyType='search' autoCorrect={false}/>{Boolean(query)&&<Pressable accessibilityLabel='검색어 지우기' onPress={()=>setQuery('')}><Text style={s.action}>×</Text></Pressable>}</View><Pressable onPress={()=>router.canGoBack()?router.back():router.replace('/')}><Text style={s.body}>취소</Text></Pressable></View>}>
 <View style={{flexDirection:'row',borderWidth:1,borderColor:'#e8e8ee',borderRadius:24,padding:3,marginBottom:18}}>{([['news','뉴스'],['companies','종목']] as const).map(([key,label])=><Pressable key={key} accessibilityRole='tab' accessibilityState={{selected:tab===key}} aria-selected={tab===key} onPress={()=>{setTab(key);setSelectedCompany(null);}} style={{flex:1,borderRadius:20,padding:10,alignItems:'center',backgroundColor:tab===key?'#4f46e5':'#fff'}}><Text style={{fontSize:14,color:tab===key?'#fff':'#858595'}}>{label}</Text></Pressable>)}</View>
 {!normalized&&<Text style={s.body}>검색어를 입력해 주세요.</Text>}{Boolean(normalized)&&!valid&&<Text style={s.body}>80자 이내, 최대 6개 단어로 입력해 주세요.</Text>}
 {valid&&(result.loading||catalog.loading)&&<Text style={s.body}>검색 중…</Text>}
 {valid&&Boolean(result.error||catalog.error)&&<View><Text accessibilityRole='alert' style={s.body}>{result.error||catalog.error}</Text><Pressable onPress={rateLimited?retryRate:reset}><Text style={s.badge}>{rateLimited?'잠시 후 다시 시도':result.status===409?'최신 분류로 처음부터':'다시 확인'}</Text></Pressable></View>}
 {valid&&result.data?.items.length===0&&<Text style={s.body}>검색 결과가 없습니다.</Text>}
 {result.data&&tab==='news'&&(result.data as SearchNewsPage).items.map(n=><NewsCard article={n} key={n.issue_id}/>)}
 {result.data&&tab==='companies'&&(result.data as SearchCompanyPage).items.map(c=><CompanyRow key={c.source_company_ref} company={c} onMore={setSelectedCompany}/>)}
 <View style={[s.row,{marginTop:18}]}>{Boolean(currentCursor)&&<Pressable style={s.chip} onPress={()=>setCursor('')}><Text style={s.chipText}>처음</Text></Pressable>}{result.data?.next_cursor&&<Pressable style={s.chip} onPress={()=>{setCursor(result.data!.next_cursor!);setCursorContext(context);}}><Text style={s.chipText}>다음 결과</Text></Pressable>}</View>
 <CompanySectorModal company={selectedCompany} version={head} onClose={()=>setSelectedCompany(null)} onRefresh={catalog.retry}/>
 </Screen>;
}
