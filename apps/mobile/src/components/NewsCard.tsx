import {Link} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import type {SearchNewsPage} from '@judoju/contracts';
import {s,RealBadge} from './Screen';
import {SaveButton} from './SaveButton';
export function NewsCard({article:n,bookmarkId}:{article:SearchNewsPage['items'][number];bookmarkId?:string}){
 return <View style={s.card}>{n.sector_id&&!n.legacy_sector?<Link href={{pathname:'/sector/[id]',params:{id:n.sector_id}}}><Text style={s.badge}>{n.sector_name}</Text></Link>:<Text style={s.badge}>{n.article_kind==='MACRO'?'매크로':n.sector_name}{n.legacy_sector?' · 이전 분류':''}</Text>}
 <RealBadge kind={n.sample_kind}/><Link href={{pathname:'/article/[id]',params:{id:n.issue_id}}} asChild><Pressable accessibilityRole='button'><Text style={s.headline}>{n.title}</Text><Text style={s.body}>{n.summary}</Text><Text style={s.date}>{new Date(n.first_published_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</Text></Pressable></Link><SaveButton id={bookmarkId??n.issue_id} canonicalId={n.issue_id}/></View>;
}
