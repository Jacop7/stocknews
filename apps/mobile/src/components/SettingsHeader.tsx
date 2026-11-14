import {Link,useRouter} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import {s} from './Screen';
export function SettingsHeader({title,settings=false}:{title:string;settings?:boolean}){
 const router=useRouter();return <><View style={{flexDirection:'row',alignItems:'center',gap:16,flexShrink:1}}><Pressable accessibilityLabel='뒤로가기' onPress={()=>router.canGoBack()?router.back():router.replace('/saved')}><Text style={s.action}>‹</Text></Pressable><Text style={{fontSize:20,fontWeight:'700',color:'#171724',flexShrink:1}}>{title}</Text></View>{settings&&<Link href='/settings' asChild><Pressable accessibilityLabel='설정'><Text style={s.action}>⚙</Text></Pressable></Link>}</>;
}
