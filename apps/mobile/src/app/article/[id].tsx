import { Link,useLocalSearchParams } from 'expo-router';
import {useRef} from 'react';
import { Pressable,Text,View } from 'react-native';
import type { PublicArticleDetail } from '@judoju/contracts';
import { Screen,s } from '../../components/Screen';
import {useCurrentRead} from '../../data/useCurrentRead';
import { ArticleBody } from '../../components/ArticleBody';
import {SaveButton} from '../../components/SaveButton';
export default function Article(){const {id}=useLocalSearchParams<{id:string}>(),result=useCurrentRead<PublicArticleDetail>('/articles/'+encodeURIComponent(id??'')),article=result.data;
 // Retain dimensions only, never an earlier article/body. A pending status read
 // must remove the old text without collapsing the ScrollView's scroll range.
 const layout=useRef({id,height:0});if(layout.current.id!==id)layout.current={id,height:0};
 return <Screen title='이슈체크 상세' actions={<><Text accessibilityLiveRegion='polite' style={s.date}>{result.loading?'확인 중':''}</Text><SaveButton id={id??''} canonicalId={article?.state==='PUBLISHED'?article.issue_id:article?.canonical_issue_id??id??''} canAdd={article?.state==='PUBLISHED'}/></>}><Link href='/'>‹ 홈으로</Link><View testID='article-current-content' style={result.loading?{minHeight:layout.current.height}:undefined} onLayout={e=>{if(article?.state==='PUBLISHED')layout.current={id,height:e.nativeEvent.layout.height};}}>{result.loading&&<Text style={s.body}>최신 게시 상태 확인 중…</Text>}{Boolean(result.error)&&<><Text style={s.body}>{result.error}</Text><Pressable onPress={result.retry}><Text style={s.badge}>다시 확인</Text></Pressable></>}{article&&article.state!=='PUBLISHED'&&<Text style={[s.body,{marginTop:24}]}>{article.message}</Text>}{article?.state==='PUBLISHED'&&<><Text style={[s.title,{marginTop:24}]}>{article.title}</Text><Text style={s.body}>{article.summary}</Text><Text style={[s.date,{textAlign:'right',marginBottom:24}]}>{new Date(article.first_published_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</Text><ArticleBody body={article.body}/></>}</View></Screen>;}
