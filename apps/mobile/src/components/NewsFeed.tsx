import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable,Text,View } from 'react-native';
import type { PublicNewsSummary,PublicSector } from '@judoju/contracts';
import { usePublicRead } from '../data/public-read';
import { s } from './Screen';
export function NewsFeed({sectorId,filters=true}:{sectorId?:string;filters?:boolean}){
 const [selected,setSelected]=useState(sectorId??'');
 const catalog=usePublicRead<PublicSector[]>('/sectors');
 const query=sectorId??selected,feed=usePublicRead<PublicNewsSummary[]>('/articles?limit=50'+(query?'&sector='+encodeURIComponent(query):''));
 return <>{filters&&<View style={s.row}>{[{id:'',name:'전체',description:''},...(catalog.data??[])].map(x=><Pressable key={x.id} accessibilityRole='button' accessibilityState={{selected:query===x.id}} style={[s.chip,query===x.id&&{borderColor:'#4f46e5'}]} onPress={()=>setSelected(x.id)}><Text style={[s.chipText,query===x.id&&{color:'#4f46e5'}]}>{x.name}</Text></Pressable>)}</View>}
 {feed.loading&&<Text style={s.body}>기사 확인 중…</Text>}{feed.error&&<View><Text style={s.body}>{feed.error}</Text><Pressable onPress={feed.retry} accessibilityRole='button'><Text style={s.badge}>다시 확인</Text></Pressable></View>}
 {!feed.loading&&!feed.error&&feed.data?.length===0&&<Text style={s.body}>해당 섹터의 게시 글이 없습니다.</Text>}
 {feed.data?.map(n=>{const sector=catalog.data?.find(x=>x.name===n.sector_name);return <View style={s.card} key={n.issue_id}>{sector?<Link href={{pathname:'/sector/[id]',params:{id:sector.id}}}><Text style={s.badge}>{sector.name}</Text></Link>:<Text style={s.badge}>{n.article_kind==='MACRO'?'매크로':n.sector_name}</Text>}<Link href={{pathname:'/article/[id]',params:{id:n.issue_id}}} asChild><Pressable accessibilityRole='button'><Text style={s.headline}>{n.title}</Text><Text style={s.body}>{n.summary}</Text><Text style={s.date}>{new Date(n.first_published_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</Text></Pressable></Link></View>;})}</>;
}
