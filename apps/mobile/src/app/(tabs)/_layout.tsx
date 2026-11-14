import { Tabs } from 'expo-router';
import { Text } from 'react-native';
const items = [{name:'index',title:'홈',icon:'⌂'},{name:'issues',title:'이슈체크',icon:'☷'},{name:'ranking',title:'섹터랭킹',icon:'▥'},{name:'saved',title:'저장',icon:'♧'}];
export default function TabLayout() { return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:'#4f46e5',tabBarInactiveTintColor:'#8e8ea0',tabBarStyle:{height:72,paddingBottom:12,paddingTop:6},tabBarLabelStyle:{fontSize:11}}}>{items.map(item=><Tabs.Screen key={item.name} name={item.name} options={{title:item.title,tabBarIcon:({color})=><Text style={{fontSize:23,color}}>{item.icon}</Text>}} />)}</Tabs>; }
