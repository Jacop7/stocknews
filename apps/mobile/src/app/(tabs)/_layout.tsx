import { Tabs } from 'expo-router';
import { Icon, type IconName } from '../../components/Icon';
import { color } from '../../theme';

const items: Array<{ name: string; title: string; icon: IconName }> = [
  { name: 'index', title: '홈', icon: 'home' },
  { name: 'issues', title: '이슈체크', icon: 'issues' },
  { name: 'ranking', title: '섹터랭킹', icon: 'ranking' },
  { name: 'saved', title: '저장', icon: 'bookmark' },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { height: 64, paddingTop: 6, paddingBottom: 8, borderTopColor: color.border, backgroundColor: color.surface },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      {items.map(item => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{ title: item.title, tabBarIcon: ({ color: tint }) => <Icon name={item.icon} size={23} color={String(tint)} strokeWidth={1.7} /> }}
        />
      ))}
    </Tabs>
  );
}
