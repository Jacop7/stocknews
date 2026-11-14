import { Link,useLocalSearchParams } from 'expo-router';
import { Pressable,Text } from 'react-native';
import type { PublicArticleDetail } from '@judoju/contracts';
import { Screen,s } from '../../components/Screen';
import { usePublicRead } from '../../data/public-read';
import { ArticleBody } from '../../components/ArticleBody';
export default function Article(){const {id}=useLocalSearchParams<{id:string}>(),result=usePublicRead<PublicArticleDetail>('/articles/'+encodeURIComponent(id??'')),article=result.data;
return <Screen title='이슈체크 상세'><Link href='/'>‹ 홈으로</Link>{result.loading&&<Text style={s.body}>최신 게시 상태 확인 중…</Text>}{Boolean(result.error)&&<><Text style={s.body}>{result.error}</Text><Pressable onPress={result.retry}><Text style={s.badge}>다시 확인</Text></Pressable></>}{article&&article.state!=='PUBLISHED'&&<Text style={[s.body,{marginTop:24}]}>{article.message}</Text>}{article?.state==='PUBLISHED'&&<><Text style={[s.title,{marginTop:24}]}>{article.title}</Text><Text style={s.body}>{article.summary}</Text><Text style={[s.date,{textAlign:'right',marginBottom:24}]}>{new Date(article.first_published_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</Text><ArticleBody body={article.body}/></>}</Screen>;}
