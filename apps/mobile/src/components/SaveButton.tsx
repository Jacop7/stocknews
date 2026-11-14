import {useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {useBookmarks} from '../data/BookmarksContext';
export function SaveButton({id,canonicalId=id,canAdd=true}:{id:string;canonicalId?:string;canAdd?:boolean}){
 const b=useBookmarks(),saved=b.entries.some(e=>e.issue_id===id||e.issue_id===canonicalId),[pending,setPending]=useState(false),[error,setError]=useState('');
 return <View><Pressable accessibilityRole='button' accessibilityLabel={saved?'저장 해제':'기사 저장'} accessibilityState={{selected:saved,disabled:pending||!b.hydrated||!saved&&!canAdd}} disabled={pending||!b.hydrated||!saved&&!canAdd} onPress={async()=>{setPending(true);setError('');try{await b.set(id,!saved,canonicalId);}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setPending(false);}}} style={{paddingVertical:7,paddingHorizontal:4,alignSelf:'flex-end'}}><Text style={{fontSize:14,color:saved?'#4f46e5':'#5a5a72'}}>{pending?'저장 중…':saved?'▣ 저장됨':'▢ 저장'}</Text></Pressable>{Boolean(error||b.error)&&<Text accessibilityRole='alert' style={{fontSize:12,color:'#5a5a72',maxWidth:280}}>{error||b.error}</Text>}</View>;
}
