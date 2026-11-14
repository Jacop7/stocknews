import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import type {PublicCatalog,SavedPage} from '@judoju/contracts';
import {Screen,s} from '../../components/Screen';
import {NewsCard} from '../../components/NewsCard';
import {SaveButton} from '../../components/SaveButton';
import {useBookmarks} from '../../data/BookmarksContext';
import {useCurrentRead} from '../../data/useCurrentRead';
export default function Saved(){
 const b=useBookmarks(),[offset,setOffset]=useState(0),catalog=useCurrentRead<PublicCatalog>('/v2/catalog');
 const start=Math.min(offset,Math.max(0,Math.ceil(b.entries.length/20)-1)*20),entries=b.entries.slice(start,start+20),ids=entries.map(x=>x.issue_id).join(','),head=catalog.data?.catalog_version;
 const result=useCurrentRead<SavedPage>(head&&ids?`/v2/saved?version=${head}&ids=${ids}`:null);
 useEffect(()=>{if(!result.data)return;const aliases=Object.fromEntries(result.data.items.filter(x=>x.canonical_issue_id&&x.canonical_issue_id!==x.requested_issue_id).map(x=>[x.requested_issue_id,x.canonical_issue_id]));if(Object.keys(aliases).length)void b.aliases(aliases).catch(()=>{});},[result.data]);
 const current=result.data?.items??[];
 return <Screen title='저장' saved><Text style={s.body}>이 기기에 저장한 글 · {b.entries.length}개</Text>
 {!b.hydrated&&!b.error&&<Text style={s.body}>저장 목록 확인 중…</Text>}{Boolean(b.error)&&<View><Text accessibilityRole='alert' style={s.body}>{b.error}</Text><Pressable onPress={()=>void b.reload().catch(()=>{})}><Text style={s.badge}>저장 목록 다시 읽기</Text></Pressable></View>}
 {b.hydrated&&!b.entries.length&&<Text style={[s.body,{marginTop:22}]}>저장한 글이 없습니다.</Text>}
 {Boolean(ids)&&(result.loading||catalog.loading)&&<Text style={s.body}>최신 게시 상태 확인 중…</Text>}
 {Boolean(ids)&&Boolean(result.error||catalog.error)&&<View><Text accessibilityRole='alert' style={s.body}>{result.error||catalog.error}</Text><Pressable onPress={()=>{if(catalog.status===429){catalog.retry();return;}if(result.status===429){result.retry();return;}catalog.retry();result.retry();}}><Text style={s.badge}>다시 확인</Text></Pressable></View>}
 {entries.map(e=>{const item=current.find(x=>x.requested_issue_id===e.issue_id);return item?.state==='PUBLISHED'?<NewsCard key={e.issue_id} article={item.card} bookmarkId={e.issue_id}/>:<View style={s.card} key={e.issue_id}><Text style={s.body}>{item?.message??'현재 게시 상태를 확인한 뒤 내용을 표시합니다.'}</Text><Text style={s.date}>저장일 {new Date(e.saved_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</Text><SaveButton id={e.issue_id} canonicalId={item?.canonical_issue_id??e.issue_id} canAdd={false}/></View>;})}
 <View style={[s.row,{marginTop:18}]}>{start>0&&<Pressable style={s.chip} onPress={()=>setOffset(Math.max(0,start-20))}><Text style={s.chipText}>이전</Text></Pressable>}{start+20<b.entries.length&&<Pressable style={s.chip} onPress={()=>setOffset(start+20)}><Text style={s.chipText}>다음</Text></Pressable>}</View>
 </Screen>;
}
