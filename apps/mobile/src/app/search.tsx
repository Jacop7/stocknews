import { useEffect, useState } from 'react';
import { Link, router } from 'expo-router';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CompanySectorPage, PublicCatalog, SearchCompany, SearchCompanyPage, SearchNewsPage } from '@judoju/contracts';
import { Icon } from '../components/Icon';
import { StatusMessage } from '../components/NewsFeed';
import { Screen, s } from '../components/Screen';
import { formatKstDateTime } from '../components/format';
import { useCurrentRead } from '../data/useCurrentRead';
import { color, layout, radius } from '../theme';

type SelectedCompany = { source_company_ref: string; name: string };
type Tab = 'news' | 'companies';

function SectorChip({ id, name, onPress }: { id: string; name: string; onPress?: () => void }) {
  return (
    <Link href={{ pathname: '/sector/[id]', params: { id, tab: 'stocks' } }} asChild>
      <Pressable style={styles.sectorChip} onPress={onPress}><Text style={styles.sectorChipText}>{name}</Text></Pressable>
    </Link>
  );
}

function NewsRow({ item, first }: { item: SearchNewsPage['items'][number]; first: boolean }) {
  return (
    <Link href={{ pathname: '/article/[id]', params: { id: item.issue_id } }} asChild>
      <Pressable accessibilityRole='link' style={StyleSheet.flatten([styles.row, !first && styles.rowBorder])}>
        <Text style={styles.rowMeta}>{(item.article_kind === 'MACRO' ? '매크로' : item.sector_name ?? '') + ' · ' + formatKstDateTime(item.first_published_at)}</Text>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowSummary} numberOfLines={2}>{item.summary}</Text>
      </Pressable>
    </Link>
  );
}

function CompanyRow({ company: c, first, onMore }: { company: SearchCompany; first: boolean; onMore: (company: SelectedCompany) => void }) {
  return (
    <View style={StyleSheet.flatten([styles.row, !first && styles.rowBorder])}>
      <Text style={styles.rowTitle}>{c.name}</Text>
      <Text style={styles.rowSummary}>{c.search_description}</Text>
      <View style={styles.chips}>
        {c.related_sectors.map(x => <SectorChip key={x.id} id={x.id} name={x.name} />)}
        {c.has_more_sectors && <Pressable style={styles.sectorChip} onPress={() => onMore(c)}><Text style={styles.sectorChipText}>관련 섹터 더보기</Text></Pressable>}
      </View>
    </View>
  );
}

function CompanySectorModal({ company, version, onClose, onRefresh }: { company: SelectedCompany | null; version: string; onClose: () => void; onRefresh: () => void }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [company?.source_company_ref, version]);
  const sectors = useCurrentRead<CompanySectorPage>(company && version ? `/v2/companies/${company.source_company_ref}/sectors?version=${version}&offset=${offset}&limit=20` : null);
  return (
    <Modal visible={Boolean(company)} transparent animationType='slide' onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={s.headline}>{company?.name} 관련 섹터</Text>
          <ScrollView>
            {sectors.loading && <Text style={s.body}>확인 중…</Text>}
            {Boolean(sectors.error) && (
              <View>
                <Text style={s.body}>{sectors.error}</Text>
                <Pressable onPress={() => { if (sectors.status === 409) onRefresh(); sectors.retry(); }}><Text style={s.badge}>다시 확인</Text></Pressable>
              </View>
            )}
            {sectors.data?.state === 'NOT_FOUND' && <Text style={s.body}>현재 제공하지 않는 기업입니다.</Text>}
            {sectors.data && <View style={styles.chips}>{sectors.data.items.map(x => <SectorChip key={x.id} id={x.id} name={x.name} onPress={onClose} />)}</View>}
            <View style={[s.row, { marginTop: 12 }]}>
              {offset > 0 && <Pressable style={s.chip} onPress={() => setOffset(0)}><Text style={s.chipText}>처음</Text></Pressable>}
              {sectors.data?.next_offset != null && <Pressable style={s.chip} onPress={() => setOffset(sectors.data!.next_offset!)}><Text style={s.chipText}>다음 섹터</Text></Pressable>}
            </View>
          </ScrollView>
          <Pressable style={styles.closeButton} onPress={onClose}><Text style={styles.closeText}>닫기</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SearchHeader({ query, onChange }: { query: string; onChange: (text: string) => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.inputBox}>
        <Icon name='search' size={20} color={color.textBody} />
        <TextInput
          autoFocus
          accessibilityLabel='뉴스·종목 검색어'
          placeholder='뉴스·종목 검색'
          placeholderTextColor={color.textMuted}
          value={query}
          onChangeText={onChange}
          style={styles.input}
          returnKeyType='search'
          autoCorrect={false}
        />
        {Boolean(query) && (
          <Pressable accessibilityRole='button' accessibilityLabel='검색어 지우기' hitSlop={8} onPress={() => onChange('')}>
            <Icon name='clear' size={20} color='#c9c9d3' />
          </Pressable>
        )}
      </View>
      <Pressable accessibilityRole='button' hitSlop={8} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <Text style={styles.cancel}>취소</Text>
      </Pressable>
    </View>
  );
}

export default function Search() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('news');
  const [cursor, setCursor] = useState('');
  const [cursorContext, setCursorContext] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null);
  const catalog = useCurrentRead<PublicCatalog>('/v2/catalog', 0, 0);
  const [knownVersion, setKnownVersion] = useState('');
  useEffect(() => { if (catalog.data) setKnownVersion(catalog.data.catalog_version); }, [catalog.data?.catalog_version]);
  const head = catalog.data?.catalog_version ?? knownVersion;

  // Same normalization and limits as the server (scripts/catalog/search-route.mjs).
  const normalized = query.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const valid = Boolean(normalized) && [...query].length <= 80 && normalized.split(' ').length <= 6 && !/[\u0000-\u001f\u007f]/u.test(normalized);
  const context = head + '|' + tab + '|' + normalized;
  const currentCursor = context === cursorContext ? cursor : '';
  const path = valid && head && catalog.data
    ? `/v2/search/${tab}?version=${head}&q=${encodeURIComponent(normalized)}&limit=20` + (currentCursor ? '&cursor=' + encodeURIComponent(currentCursor) : '')
    : null;
  const result = useCurrentRead<SearchNewsPage | SearchCompanyPage>(path, 400, 0);
  const rateLimited = catalog.status === 429 || result.status === 429;
  const retry = () => {
    if (rateLimited) { if (catalog.status === 429) catalog.retry(); if (result.status === 429) result.retry(); return; }
    setCursor(''); setCursorContext(''); catalog.retry(); result.retry();
  };
  const items = result.data?.items ?? [];

  return (
    <Screen title='검색' header={<SearchHeader query={query} onChange={text => { setQuery(text); setSelectedCompany(null); }} />}>
      <View style={styles.tabs} accessibilityRole='tablist'>
        {([['news', '뉴스'], ['companies', '종목']] as const).map(([key, label]) => (
          <Pressable key={key} accessibilityRole='tab' accessibilityState={{ selected: tab === key }} onPress={() => { setTab(key); setSelectedCompany(null); }} style={[styles.tab, tab === key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!normalized && <StatusMessage text='검색어를 입력해 주세요.' />}
      {Boolean(normalized) && !valid && <StatusMessage text='80자 이내, 최대 6개 단어로 입력해 주세요.' />}
      {valid && (result.loading || catalog.loading) && !result.data && <StatusMessage text='검색하고 있습니다.' />}
      {valid && Boolean(result.error || catalog.error) && (
        <StatusMessage text={result.error || catalog.error} actionLabel={rateLimited ? '잠시 후 다시 시도' : result.status === 409 ? '최신 분류로 처음부터' : '다시 확인'} onAction={retry} />
      )}
      {valid && result.data && items.length === 0 && <StatusMessage text='검색 결과가 없습니다.' />}
      {items.length > 0 && (
        <View style={styles.list}>
          {tab === 'news'
            ? (items as SearchNewsPage['items']).map((n, i) => <NewsRow key={n.issue_id} item={n} first={i === 0} />)
            : (items as SearchCompany[]).map((c, i) => <CompanyRow key={c.source_company_ref} company={c} first={i === 0} onMore={setSelectedCompany} />)}
        </View>
      )}
      {(Boolean(currentCursor) || Boolean(result.data?.next_cursor)) && (
        <View style={[s.row, { justifyContent: 'center', marginTop: 12 }]}>
          {Boolean(currentCursor) && <Pressable style={s.chip} onPress={() => setCursor('')}><Text style={s.chipText}>처음</Text></Pressable>}
          {result.data?.next_cursor && <Pressable style={s.chip} onPress={() => { setCursor(result.data!.next_cursor!); setCursorContext(context); }}><Text style={s.chipText}>다음 결과</Text></Pressable>}
        </View>
      )}
      <CompanySectorModal company={selectedCompany} version={head} onClose={() => setSelectedCompany(null)} onRefresh={catalog.retry} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: layout.gutter, paddingVertical: 9, backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.border },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: color.primary, borderRadius: 12, paddingHorizontal: 12 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 16, color: color.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}) },
  cancel: { fontSize: 15, color: color.text },
  tabs: { flexDirection: 'row', backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: 24, padding: 4, marginBottom: 14 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 20 },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: 14, color: color.textBody },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  list: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card, overflow: 'hidden' },
  row: { paddingHorizontal: 20, paddingVertical: 16 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  rowMeta: { fontSize: 12, color: color.textMuted, marginBottom: 6 },
  rowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: color.text, marginBottom: 4 },
  rowSummary: { fontSize: 13, lineHeight: 20, color: color.textBody },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  sectorChip: { backgroundColor: color.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  sectorChipText: { fontSize: 12, color: color.primaryText },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: { maxHeight: '85%', backgroundColor: color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22 },
  closeButton: { borderWidth: 1, borderColor: color.border, borderRadius: radius.small, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  closeText: { fontSize: 14, color: color.text },
});
