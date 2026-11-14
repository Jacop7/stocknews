import {useEffect,useState} from 'react';
import {Link} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import type {PublicCatalog,CatalogNewsPage,CalendarPeriod} from '@judoju/contracts';
import {usePublicRead} from '../data/public-read';
import {useCatalogFilter} from '../data/CatalogContext';
import {calendarPeriods,periodRange,selectionLabels,validSelection} from '../data/catalog-filter.mjs';
import {SectorFilter} from './SectorFilter';
import {s} from './Screen';
import {NewsCard} from './NewsCard';
export function NewsFeed({sectorId,filters=true}:{sectorId?:string;filters?:boolean}){
 const catalog=usePublicRead<PublicCatalog>('/v2/catalog'),{selected,setSelected,period,setPeriod}=useCatalogFilter(),[popup,setPopup]=useState(false),[cursor,setCursor]=useState('');
 const version=catalog.data?.catalog_version??'',query=sectorId?[sectorId]:selected,context=version+'|'+query.join(',')+'|'+period;
 const [cursorContext,setCursorContext]=useState(''),currentCursor=cursorContext===context?cursor:'';
 const feed=usePublicRead<CatalogNewsPage>(version?'/v2/articles?version='+version+'&period='+period+'&limit=20'+(query.length?'&sectors='+query.join(','):'')+(currentCursor?'&cursor='+encodeURIComponent(currentCursor):''):null);
 useEffect(()=>{if(!catalog.data)return;const valid=validSelection(selected,catalog.data);if(valid.join(',')!==selected.join(','))setSelected(valid);},[version]);
 const labels=catalog.data?selectionLabels(selected,catalog.data) as Array<{id:string;name:string;ids:string[]}>:[];
 return <>{filters&&<><View style={{flexDirection:'row',borderWidth:1,borderColor:'#e8e8ee',borderRadius:24,padding:3,marginBottom:16}}>{calendarPeriods.map(([key,label])=><Pressable key={key} accessibilityRole='tab' aria-selected={period===key} accessibilityState={{selected:period===key}} style={{flex:1,paddingVertical:10,alignItems:'center',borderRadius:20,backgroundColor:period===key?'#4f46e5':'#fff'}} onPress={()=>{setPeriod(key as CalendarPeriod);setCursor('');}}><Text style={{fontSize:12,fontWeight:period===key?'700':'400',color:period===key?'#fff':'#858595'}}>{label}</Text></Pressable>)}</View>
 <View style={s.row}><Pressable style={[s.chip,{borderColor:selected.length?'#4f46e5':'#e8e8ee'}]} onPress={()=>setPopup(true)} disabled={!catalog.data}><Text style={[s.chipText,{color:selected.length?'#4f46e5':'#5a5a72'}]}>☷ 필터</Text></Pressable>{labels.map(label=><Pressable style={s.chip} key={label.id} onPress={()=>setSelected(selected.filter(id=>!label.ids.includes(id)))}><Text style={s.chipText}>{label.name} ×</Text></Pressable>)}</View>{catalog.data&&<SectorFilter visible={popup} onClose={()=>setPopup(false)} selected={selected} catalog={catalog.data} onApply={ids=>{setSelected(ids);setCursor('');}}/>}</>}
 <Text style={[s.date,{marginBottom:4}]}>{periodRange(period,feed.data?new Date(feed.data.as_of):new Date())}</Text>
 {(feed.loading||catalog.loading)&&<Text style={s.body}>기사 확인 중…</Text>}{Boolean(feed.error||catalog.error)&&<View><Text style={s.body}>{feed.error||catalog.error}</Text><Pressable onPress={()=>{setCursor('');setCursorContext('');catalog.retry();feed.retry();}} accessibilityRole='button'><Text style={s.badge}>첫 페이지 다시 확인</Text></Pressable></View>}
 {!feed.loading&&!feed.error&&feed.data?.items.length===0&&<Text style={s.body}>선택한 기간·섹터의 게시 글이 없습니다.</Text>}
 {feed.data?.items.map(n=><NewsCard article={n} key={n.issue_id}/>)}
 <View style={[s.row,{marginTop:18}]}>{Boolean(currentCursor)&&<Pressable style={s.chip} onPress={()=>setCursor('')}><Text style={s.chipText}>첫 페이지</Text></Pressable>}{Boolean(feed.data?.next_cursor)&&<Pressable style={s.chip} onPress={()=>{setCursor(feed.data?.next_cursor??'');setCursorContext(context);}}><Text style={s.chipText}>다음 기사</Text></Pressable>}</View></>;
}
