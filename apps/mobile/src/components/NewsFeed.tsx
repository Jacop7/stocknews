import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CalendarPeriod, CatalogNewsPage, PublicCatalog } from '@judoju/contracts';
import { usePublicRead } from '../data/public-read';
import { useCatalogFilter } from '../data/CatalogContext';
import { calendarPeriods, periodRange, selectionLabels, validSelection } from '../data/catalog-filter.mjs';
import { color } from '../theme';
import { Icon } from './Icon';
import { NewsCard } from './NewsCard';
import { s } from './Screen';
import { SectorFilter } from './SectorFilter';

type Label = { id: string; name: string; ids: string[] };

export function PeriodTabs({ value, onChange }: { value: CalendarPeriod; onChange: (p: CalendarPeriod) => void }) {
  return (
    <View style={styles.periods} accessibilityRole='tablist'>
      {calendarPeriods.map(([key, label]) => {
        const active = value === key;
        return (
          <Pressable key={key} accessibilityRole='tab' accessibilityState={{ selected: active }} style={[styles.period, active && styles.periodActive]} onPress={() => onChange(key as CalendarPeriod)}>
            <Text style={[styles.periodText, active && styles.periodTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FilterBar({ labels, disabled, onOpen, onRemove }: { labels: Label[]; disabled?: boolean; onOpen: () => void; onRemove: (ids: string[]) => void }) {
  return (
    <View style={styles.filterBar}>
      <Pressable accessibilityRole='button' accessibilityLabel='섹터 필터 열기' style={[s.chip, labels.length > 0 && styles.chipActive]} onPress={onOpen} disabled={disabled}>
        <Icon name='filter' size={17} color={labels.length ? color.primary : color.textBody} />
        <Text style={[s.chipText, labels.length > 0 && styles.chipTextActive]}>필터</Text>
      </Pressable>
      {labels.map(label => (
        <Pressable key={label.id} accessibilityRole='button' accessibilityLabel={label.name + ' 선택 해제'} style={[s.chip, styles.chipActive]} onPress={() => onRemove(label.ids)}>
          <Text style={[s.chipText, styles.chipTextActive]}>{label.name}</Text>
          <Icon name='close' size={13} color={color.primary} strokeWidth={2} />
        </Pressable>
      ))}
    </View>
  );
}

export function StatusMessage({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyText}>{text}</Text>
      {actionLabel && onAction && (
        <Pressable accessibilityRole='button' onPress={onAction} style={{ marginTop: 14 }}><Text style={s.badge}>{actionLabel}</Text></Pressable>
      )}
    </View>
  );
}

// 이슈체크 list: period tabs, sector filter popup and the time-ordered feed.
export function NewsFeed({ sectorId, filters = true }: { sectorId?: string; filters?: boolean }) {
  const catalog = usePublicRead<PublicCatalog>('/v2/catalog');
  const { selected, setSelected, period, setPeriod } = useCatalogFilter();
  const [popup, setPopup] = useState(false);
  const [cursor, setCursor] = useState('');
  const [cursorContext, setCursorContext] = useState('');

  const version = catalog.data?.catalog_version ?? '';
  const query = sectorId ? [sectorId] : selected;
  const context = version + '|' + query.join(',') + '|' + period;
  const currentCursor = cursorContext === context ? cursor : '';
  const path = version
    ? `/v2/articles?version=${version}&period=${period}&limit=20` + (query.length ? '&sectors=' + query.join(',') : '') + (currentCursor ? '&cursor=' + encodeURIComponent(currentCursor) : '')
    : null;
  const feed = usePublicRead<CatalogNewsPage>(path);

  // Drop selections that disappeared from a newer catalog version.
  useEffect(() => {
    if (!catalog.data) return;
    const valid = validSelection(selected, catalog.data);
    if (valid.join(',') !== selected.join(',')) setSelected(valid);
  }, [version]);

  const labels = catalog.data ? (selectionLabels(selected, catalog.data) as Label[]) : [];
  const reset = () => { setCursor(''); setCursorContext(''); catalog.retry(); feed.retry(); };

  return (
    <>
      {filters && (
        <>
          <PeriodTabs value={period} onChange={p => { setPeriod(p); setCursor(''); }} />
          <FilterBar labels={labels} disabled={!catalog.data} onOpen={() => setPopup(true)} onRemove={ids => setSelected(selected.filter(id => !ids.includes(id)))} />
          {catalog.data && (
            <SectorFilter visible={popup} onClose={() => setPopup(false)} selected={selected} catalog={catalog.data} onApply={ids => { setSelected(ids); setCursor(''); }} />
          )}
        </>
      )}
      <Text style={styles.range}>{periodRange(period, feed.data ? new Date(feed.data.as_of) : new Date())}</Text>
      {(feed.loading || catalog.loading) && !feed.data && <StatusMessage text='기사를 확인하고 있습니다.' />}
      {Boolean(feed.error || catalog.error) && <StatusMessage text={feed.error || catalog.error} actionLabel='첫 페이지 다시 확인' onAction={reset} />}
      {!feed.loading && !feed.error && feed.data?.items.length === 0 && <StatusMessage text='선택한 기간·섹터의 게시 글이 없습니다.' />}
      {feed.data?.items.map(n => <NewsCard article={n} key={n.issue_id} />)}
      {(Boolean(currentCursor) || Boolean(feed.data?.next_cursor)) && (
        <View style={styles.pager}>
          {Boolean(currentCursor) && <Pressable style={s.chip} onPress={() => setCursor('')}><Text style={s.chipText}>첫 페이지</Text></Pressable>}
          {Boolean(feed.data?.next_cursor) && (
            <Pressable style={s.chip} onPress={() => { setCursor(feed.data?.next_cursor ?? ''); setCursorContext(context); }}><Text style={s.chipText}>다음 기사</Text></Pressable>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: 24, padding: 4, marginBottom: 14 },
  period: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 20 },
  periodActive: { backgroundColor: color.primary },
  periodText: { fontSize: 13, color: color.textBody },
  periodTextActive: { color: '#fff', fontWeight: '700' },
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chipActive: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipTextActive: { color: color.primary, fontWeight: '600' },
  range: { fontSize: 12, color: color.textMuted, textAlign: 'right', marginBottom: 8 },
  pager: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 8 },
});
