import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { BackHeader } from './Screen';
import { Icon } from './Icon';

export function SettingsHeader({ title, settings = false }: { title: string; settings?: boolean }) {
  return (
    <BackHeader
      title={title}
      fallback='/saved'
      actions={settings ? (
        <Link href='/settings' asChild>
          <Pressable accessibilityRole='button' accessibilityLabel='설정' hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name='settings' size={22} strokeWidth={1.7} />
          </Pressable>
        </Link>
      ) : undefined}
    />
  );
}
