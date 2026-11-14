import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { PublicSector } from '@judoju/contracts';
import { Screen,s } from '../../components/Screen';
import { NewsFeed } from '../../components/NewsFeed';
import { usePublicRead } from '../../data/public-read';
export default function Sector(){const {id}=useLocalSearchParams<{id:string}>(),catalog=usePublicRead<PublicSector[]>('/sectors'),sector=catalog.data?.find(x=>x.id===id);return <Screen title='섹터체크'><Text style={s.title}>{sector?.name??'섹터'}</Text>{sector&&<Text style={s.body}>{sector.description}</Text>}<Text style={[s.badge,{marginTop:24}]}>이슈체크</Text><NewsFeed sectorId={id} filters={false}/></Screen>;}
