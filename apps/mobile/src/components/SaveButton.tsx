import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useBookmarks } from '../data/BookmarksContext';
import { color } from '../theme';
import { Icon } from './Icon';

// Icon toggle. The bookmark store de-duplicates by issue id and canonical id.
export function SaveButton({ id, canonicalId = id, canAdd = true, size = 22 }: { id: string; canonicalId?: string; canAdd?: boolean; size?: number }) {
  const b = useBookmarks();
  const saved = b.entries.some(e => e.issue_id === id || e.issue_id === canonicalId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const disabled = pending || !b.hydrated || (!saved && !canAdd);
  const toggle = async () => {
    setPending(true);
    setError('');
    try { await b.set(id, !saved, canonicalId); }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
    finally { setPending(false); }
  };
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={saved ? '저장 해제' : '기사 저장'}
        accessibilityState={{ selected: saved, disabled }}
        disabled={disabled}
        onPress={() => void toggle()}
        hitSlop={10}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: pending ? 0.4 : 1 }}
      >
        <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={size} color={saved ? color.primary : color.textBody} strokeWidth={1.7} />
      </Pressable>
      {Boolean(error || b.error) && <Text accessibilityRole='alert' style={{ fontSize: 12, color: color.textBody, maxWidth: 240 }}>{error || b.error}</Text>}
    </View>
  );
}
