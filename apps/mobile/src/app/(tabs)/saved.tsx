import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PublicCatalog, SavedPage } from '@judoju/contracts';
import { NewsCard } from '../../components/NewsCard';
import { StatusMessage } from '../../components/NewsFeed';
import { SaveButton } from '../../components/SaveButton';
import { Screen, s } from '../../components/Screen';
import { formatKstDate } from '../../components/format';
import { useBookmarks } from '../../data/BookmarksContext';
import { useCurrentRead } from '../../data/useCurrentRead';

const PAGE = 20;

// 저장: device-local bookmarks, re-resolved against the current publication state.
export default function Saved() {
  const b = useBookmarks();
  const [offset, setOffset] = useState(0);
  const catalog = useCurrentRead<PublicCatalog>('/v2/catalog');
  const start = Math.min(offset, Math.max(0, Math.ceil(b.entries.length / PAGE) - 1) * PAGE);
  const entries = b.entries.slice(start, start + PAGE);
  const ids = entries.map(x => x.issue_id).join(',');
  const head = catalog.data?.catalog_version;
  const result = useCurrentRead<SavedPage>(head && ids ? `/v2/saved?version=${head}&ids=${ids}` : null);

  // Merged/renamed issues: remember the canonical id so the same story is never saved twice.
  useEffect(() => {
    if (!result.data) return;
    const aliases = Object.fromEntries(result.data.items
      .filter(x => x.canonical_issue_id && x.canonical_issue_id !== x.requested_issue_id)
      .map(x => [x.requested_issue_id, x.canonical_issue_id]));
    if (Object.keys(aliases).length) void b.aliases(aliases).catch(() => {});
  }, [result.data]);

  const current = result.data?.items ?? [];
  const retry = () => {
    if (catalog.status === 429) { catalog.retry(); return; }
    if (result.status === 429) { result.retry(); return; }
    catalog.retry();
    result.retry();
  };

  return (
    <Screen title='저장' variant='saved'>
      {!b.hydrated && !b.error && <StatusMessage text='저장 목록을 확인하고 있습니다.' />}
      {Boolean(b.error) && <StatusMessage text={b.error} actionLabel='저장 목록 다시 읽기' onAction={() => void b.reload().catch(() => {})} />}
      {b.hydrated && !b.entries.length && <StatusMessage text='저장한 글이 없습니다.' />}
      {Boolean(ids) && Boolean(result.error || catalog.error) && <StatusMessage text={result.error || catalog.error} actionLabel='다시 확인' onAction={retry} />}
      {entries.map(e => {
        const item = current.find(x => x.requested_issue_id === e.issue_id);
        if (item?.state === 'PUBLISHED') return <NewsCard key={e.issue_id} article={item.card} bookmarkId={e.issue_id} />;
        return (
          <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} key={e.issue_id}>
            <View style={{ flex: 1 }}>
              <Text style={s.body}>{item?.message ?? '현재 게시 상태를 확인한 뒤 내용을 표시합니다.'}</Text>
              <Text style={[s.date, { marginTop: 6 }]}>저장일 {formatKstDate(e.saved_at)}</Text>
            </View>
            <SaveButton id={e.issue_id} canonicalId={item?.canonical_issue_id ?? e.issue_id} canAdd={false} />
          </View>
        );
      })}
      {b.entries.length > PAGE && (
        <View style={[s.row, { justifyContent: 'center', marginTop: 8 }]}>
          {start > 0 && <Pressable style={s.chip} onPress={() => setOffset(Math.max(0, start - PAGE))}><Text style={s.chipText}>이전</Text></Pressable>}
          {start + PAGE < b.entries.length && <Pressable style={s.chip} onPress={() => setOffset(start + PAGE)}><Text style={s.chipText}>다음</Text></Pressable>}
        </View>
      )}
    </Screen>
  );
}
