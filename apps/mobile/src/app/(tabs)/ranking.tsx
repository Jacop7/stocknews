import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PublicCatalog } from '@judoju/contracts';
import { Icon } from '../../components/Icon';
import { StatusMessage } from '../../components/NewsFeed';
import { Screen } from '../../components/Screen';
import { usePublicRead } from '../../data/public-read';
import { color, radius } from '../../theme';

// 섹터랭킹. Per the latest decision the app shows no prices, change rates or
// sector averages. Until a verified market-data supply exists the list keeps
// catalog order and says so; the order source is the only thing that changes later.
export default function Ranking() {
  const catalog = usePublicRead<PublicCatalog>('/v2/catalog');
  const [parentId, setParentId] = useState<string | null>(null);
  const parents = catalog.data?.parents ?? [];
  const active = parents.find(p => p.id === parentId) ?? null;
  const rows = active ? active.sectors : parents.flatMap(p => p.sectors);
  return (
    <Screen title='섹터랭킹' variant='brand'>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {[{ id: null as string | null, name: '전체' }, ...parents].map(p => {
          const selected = p.id === (active?.id ?? null);
          return (
            <Pressable key={p.id ?? 'all'} accessibilityRole='tab' accessibilityState={{ selected }} onPress={() => setParentId(p.id)} style={[styles.tab, selected && styles.tabActive]}>
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>{p.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.note}>시세 연결 전에는 섹터 분류 순서로 표시합니다.</Text>
      {catalog.loading && !catalog.data && <StatusMessage text='섹터를 확인하고 있습니다.' />}
      {Boolean(catalog.error) && <StatusMessage text={catalog.error} actionLabel='다시 확인' onAction={catalog.retry} />}
      {rows.length > 0 && (
        <View style={styles.list}>
          {rows.map((sector, index) => (
            <Link key={sector.id} href={{ pathname: '/sector/[id]', params: { id: sector.id } }} asChild>
              <Pressable accessibilityRole='link' style={StyleSheet.flatten([styles.row, index > 0 && styles.rowBorder])}>
                <Text style={styles.name}>{sector.name}</Text>
                <Icon name='chevronRight' size={18} color={color.textMuted} />
              </Pressable>
            </Link>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: 8, paddingBottom: 12 },
  tab: { borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 8 },
  tabActive: { backgroundColor: color.primary, borderColor: color.primary },
  tabText: { fontSize: 13, color: color.textBody },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  note: { fontSize: 12, color: color.textMuted, marginBottom: 10 },
  list: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: color.text },
});
