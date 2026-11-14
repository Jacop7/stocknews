import {useEffect,useState} from 'react';
import {Pressable,Switch,Text,View} from 'react-native';
import type {PublicCatalog} from '@judoju/contracts';
import {Screen,s} from '../components/Screen';
import {SettingsHeader} from '../components/SettingsHeader';
import {useInstallation} from '../data/InstallationContext';
import {usePublicRead} from '../data/public-read';
import type {InstallationSettings} from '../data/installation-types';
export default function NotificationSettings(){
 const i=useInstallation(),catalog=usePublicRead<PublicCatalog>('/v2/catalog'),[draft,setDraft]=useState<InstallationSettings|null>(null),[dirty,setDirty]=useState(false);
 useEffect(()=>{if(!dirty)setDraft(i.state.settings??null);},[i.state,dirty]);
 const change=(fn:(s:InstallationSettings)=>InstallationSettings)=>{if(draft){setDraft(fn(draft));setDirty(true);}};
 const fields=[['morning_issue','오전 장 이슈 알림'],['closing_issue','장 마감 이슈 알림'],['favorite_sector_issue','관심 섹터 이슈 알림']] as const;
 const mismatch=draft&&catalog.data&&String(draft.catalog_version)!==catalog.data.catalog_version;
 return <Screen title='알림 설정' header={<SettingsHeader title='알림 설정'/>}><Text style={s.body}>알림 선호 설정입니다. 실제 푸시 발송은 연결되지 않았으며 OS 알림 권한을 요청하지 않습니다.</Text>
 {!draft&&<Text style={[s.body,{marginTop:24}]}>설정에서 이 기기 서버 연결을 확인해 주세요.</Text>}
 {fields.map(([key,label])=><View key={key} style={[s.card,{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:16}]}><Text style={{fontSize:15,color:'#171724',flex:1}}>{label}</Text><Switch accessibilityLabel={label} value={draft?.[key]??false} disabled={!draft||i.busy} trackColor={{true:'#4f46e5',false:'#e8e8ee'}} onValueChange={value=>change(s=>({...s,[key]:value}))}/></View>)}
 <Text style={[s.badge,{marginTop:24}]}>관심 섹터</Text>{Boolean(catalog.error)&&<Text style={s.body}>{catalog.error}</Text>}
 {catalog.data?.parents.map(parent=><View key={parent.id} style={{marginTop:18}}><Text style={{fontSize:13,color:'#555563',fontWeight:'600',marginBottom:12}}>{parent.name}</Text><View style={s.row}>{parent.sectors.map(child=>{const checked=draft?.sector_ids.includes(child.id);return <Pressable key={child.id} accessibilityRole='checkbox' aria-checked={Boolean(checked)} accessibilityState={{checked:Boolean(checked),disabled:!draft||i.busy}} disabled={!draft||i.busy} style={[s.chip,checked?{borderColor:'#4f46e5'}:{}]} onPress={()=>change(s=>({...s,sector_ids:checked?s.sector_ids.filter(id=>id!==child.id):[...s.sector_ids,child.id]}))}><Text style={[s.chipText,checked?{color:'#4f46e5'}:{}]}>{checked?'✓ ':''}{child.name}</Text></Pressable>;})}</View></View>)}
 {Boolean(mismatch)&&<Text accessibilityRole='alert' style={s.body}>섹터 구성이 바뀌었습니다. 최신 설정을 다시 확인해 주세요.</Text>}
 {Boolean(i.error)&&<Text accessibilityRole='alert' style={s.body}>설정을 저장하지 못했습니다. 다른 화면의 변경 또는 연결 상태를 확인해 주세요. ({i.error})</Text>}
 <View style={s.row}><Pressable disabled={!dirty||!draft||i.busy||Boolean(mismatch)} style={s.chip} onPress={()=>{if(draft)void i.save({...draft,catalog_version:Number(draft.catalog_version)}).then(ok=>{if(ok)setDirty(false);});}}><Text style={[s.chipText,{color:dirty?'#4f46e5':'#8e8ea0'}]}>{i.busy?'저장 중…':'설정 저장'}</Text></Pressable><Pressable disabled={i.busy} style={s.chip} onPress={()=>{setDirty(false);void i.refresh();catalog.retry();}}><Text style={s.chipText}>최신 설정 다시 읽기</Text></Pressable></View>
 {i.state.history?.filter(x=>x.reason==='INACTIVE_SECTOR_REMOVED').map(x=><Text key={x.settings_revision} style={s.body}>{x.removed_sectors.map(s=>s.name).join(', ')} · 비활성화되어 관심 섹터에서 제외됨</Text>)}
 </Screen>;
}
