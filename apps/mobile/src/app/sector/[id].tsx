import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { PublicReferenceSector, ReferenceCompany } from '@judoju/contracts';
import { NewsFeed, StatusMessage } from '../../components/NewsFeed';
import { Screen, s } from '../../components/Screen';
import { usePublicRead } from '../../data/public-read';
import { color, radius } from '../../theme';

// Korean companies only. No price or change rate is shown (latest decision);
// the Naver Finance link needs a verified stock code, which is not resolved yet.
function Companies({ rows }: { rows: ReferenceCompany[] }) {
  return (
    <>
      {rows.map(row => (
        <View key={row.membership_id} style={styles.company}>
          <Text style={styles.companyName}>{row.name}</Text>
          <Text style={styles.companyDescription}>{row.description}</Text>
        </View>
      ))}
    </>
  );
}

export default function Sector() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const [tab, setTab] = useState<'NEWS' | 'COMPANIES'>(initialTab === 'stocks' ? 'COMPANIES' : 'NEWS');
  const [offset, setOffset] = useState(0);
  const [pageVersion, setPageVersion] = useState('');
  const result = usePublicRead<PublicReferenceSector>('/v2/sectors/' + encodeURIComponent(id ?? '') + '?offset=' + offset + (offset && pageVersion ? '&version=' + pageVersion : ''));
  const sector = result.data;

  return (
    <Screen title='섹터'>
      {result.loading && !sector && <StatusMessage text='섹터를 확인하고 있습니다.' />}
      {Boolean(result.error) && <StatusMessage text={result.error} actionLabel='다시 확인' onAction={() => { setOffset(0); setPageVersion(''); result.retry(); }} />}
      {sector?.state === 'NOT_FOUND' && <StatusMessage text='현재 제공하지 않는 섹터입니다.' />}
      {sector?.state === 'AVAILABLE' && (
        <>
          <Text style={[s.title, { marginTop: 6 }]}>{sector.name}</Text>
          <Text style={s.body}>{sector.description}</Text>
          <View style={styles.tabs}>
            {([['NEWS', '이슈체크'], ['COMPANIES', '관련 종목']] as const).map(([key, label]) => (
              <Pressable key={key} accessibilityRole='tab' accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {tab === 'NEWS' ? <NewsFeed sectorId={id} filters={false} /> : (
            <View style={styles.list}>
              <Companies rows={sector.ungrouped_members} />
              {sector.groups.filter(g => g.members.length > 0).map(group => (
                <View key={group.id}>
                  <Text style={styles.groupTitle}>{group.name}</Text>
                  <Companies rows={group.members} />
                </View>
              ))}
              {sector.total_memberships === 0 && <Text style={[s.body, { paddingVertical: 20 }]}>연결된 기업이 없습니다.</Text>}
              {(offset > 0 || sector.next_offset !== null) && (
                <View style={[s.row, { marginTop: 16 }]}>
                  {offset > 0 && <Pressable style={s.chip} onPress={() => { setOffset(0); setPageVersion(''); }}><Text style={s.chipText}>처음</Text></Pressable>}
                  {sector.next_offset !== null && (
                    <Pressable style={s.chip} onPress={() => { setPageVersion(sector.catalog_version); setOffset(sector.next_offset ?? 0); }}><Text style={s.chipText}>더 보기</Text></Pressable>
                  )}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: color.border, marginTop: 20, marginBottom: 16 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderColor: 'transparent' },
  tabActive: { borderColor: color.primary },
  tabText: { fontSize: 14, color: color.textMuted },
  tabTextActive: { color: color.text, fontWeight: '700' },
  list: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card, paddingHorizontal: 20, paddingVertical: 6 },
  company: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.divider },
  companyName: { fontSize: 15, fontWeight: '600', color: color.text },
  companyDescription: { fontSize: 12, lineHeight: 19, color: color.textBody, marginTop: 3 },
  groupTitle: { paddingTop: 18, paddingBottom: 4, fontSize: 13, fontWeight: '700', color: color.text },
});
