import {useRouter} from 'expo-router';
import {Text} from 'react-native';
import type {PublicCatalog} from '@judoju/contracts';
import { Screen,s } from '../components/Screen';
import {SectorFilter} from '../components/SectorFilter';
import {usePublicRead} from '../data/public-read';
import {useCatalogFilter} from '../data/CatalogContext';
export default function Page(){const router=useRouter(),catalog=usePublicRead<PublicCatalog>('/v2/catalog'),{selected,setSelected}=useCatalogFilter();return <Screen title='필터'>{Boolean(catalog.error)&&<Text style={s.body}>{catalog.error}</Text>}{catalog.data&&<SectorFilter visible catalog={catalog.data} selected={selected} onApply={setSelected} onClose={()=>router.canGoBack()?router.back():router.replace('/')}/>}</Screen>;}
