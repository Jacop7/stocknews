import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PublicCardImpact, PublicHomeCard, SearchNewsPage } from '@judoju/contracts';
import { color, radius } from '../theme';
import { SaveButton } from './SaveButton';
import { formatKstDateTime } from './format';

type ListArticle = SearchNewsPage['items'][number];

const directionLabel = { BENEFIT: '수혜섹터', DAMAGE: '피해섹터', RELATED: '연관섹터' } as const;

export function DirectionBadge({ direction }: { direction: PublicCardImpact['direction'] }) {
  const tone = direction === 'BENEFIT' ? styles.benefit : direction === 'DAMAGE' ? styles.damage : styles.related;
  const text = direction === 'BENEFIT' ? styles.benefitText : direction === 'DAMAGE' ? styles.damageText : styles.relatedText;
  return <View style={[styles.direction, tone]}><Text style={[styles.directionText, text]}>{directionLabel[direction]}</Text></View>;
}

// One row per direction: first sector (companies), plus "외 총 N개" for the rest.
export function ImpactRows({ impacts }: { impacts?: PublicCardImpact[] }) {
  if (!impacts?.length) return null;
  const rows = (['BENEFIT', 'DAMAGE'] as const)
    .map(direction => ({ direction, items: impacts.filter(x => x.direction === direction) }))
    .filter(x => x.items.length > 0);
  if (!rows.length) return null;
  return (
    <View style={styles.impacts}>
      {rows.map(({ direction, items }) => {
        const [first] = items;
        const label = first.sector_name + (first.companies.length ? ` (${first.companies.join(', ')})` : '');
        return (
          <View key={direction} style={styles.impactRow}>
            <DirectionBadge direction={direction} />
            <Text style={styles.impactText} numberOfLines={1}>{label}</Text>
            {items.length > 1 && <Text style={styles.more}>외 총 {items.length - 1}개</Text>}
          </View>
        );
      })}
    </View>
  );
}

export function CompanyChips({ impacts }: { impacts?: PublicCardImpact[] }) {
  const names = [...new Set((impacts ?? []).filter(x => x.direction === 'BENEFIT').flatMap(x => x.companies))].slice(0, 6);
  if (!names.length) return null;
  return (
    <View style={styles.chips}>
      {names.map(name => <View key={name} style={styles.company}><Text style={styles.companyText}>{name}</Text></View>)}
    </View>
  );
}

// 이슈체크 list card: date, title, summary and impacted sectors.
export function NewsCard({ article: n, bookmarkId }: { article: ListArticle; bookmarkId?: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.date}>
          {n.sector_name ? <Text style={styles.sector}>{n.article_kind === 'MACRO' ? '매크로' : n.sector_name}{n.legacy_sector ? ' · 이전 분류' : ''}  </Text> : n.article_kind === 'MACRO' ? <Text style={styles.sector}>매크로  </Text> : null}
          {formatKstDateTime(n.first_published_at)}
        </Text>
        <SaveButton id={bookmarkId ?? n.issue_id} canonicalId={n.issue_id} />
      </View>
      <Link href={{ pathname: '/article/[id]', params: { id: n.issue_id } }} asChild>
        <Pressable accessibilityRole='link'>
          <Text style={styles.title}>{n.title}</Text>
          <Text style={styles.summary} numberOfLines={2}>{n.summary}</Text>
          <ImpactRows impacts={n.impacts} />
        </Pressable>
      </Link>
    </View>
  );
}

// The gateway's home card has no primary sector; fall back to the first impacted sector.
function homeLabel(n: PublicHomeCard): string {
  if (n.article_kind === 'MACRO') return '매크로';
  return n.sector_name ?? n.impacts?.find(x => x.direction === 'BENEFIT')?.sector_name ?? n.impacts?.[0]?.sector_name ?? '';
}

// 홈 ranked card: rank number, sector label, title, summary and related companies.
export function RankedCard({ rank, article: n }: { rank: number; article: PublicHomeCard }) {
  return (
    <View style={styles.card}>
      <View style={styles.rankLayout}>
        <Text style={styles.rank}>{rank}</Text>
        <View style={styles.rankBody}>
          <View style={styles.topRow}>
            {homeLabel(n) ? <Text style={styles.sectorLabel} numberOfLines={1}>{homeLabel(n)}</Text> : <View style={{ flex: 1 }} />}
            <SaveButton id={n.issue_id} />
          </View>
          <Link href={{ pathname: '/article/[id]', params: { id: n.issue_id } }} asChild>
            <Pressable accessibilityRole='link'>
              <Text style={styles.title}>{n.title}</Text>
              <Text style={styles.summary} numberOfLines={3}>{n.summary}</Text>
              <CompanyChips impacts={n.impacts} />
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  date: { flex: 1, fontSize: 12, color: color.textMuted },
  sector: { color: color.primary, fontWeight: '600' },
  sectorLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: color.primary },
  title: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: color.text, marginBottom: 6 },
  summary: { fontSize: 14, lineHeight: 21, color: color.textBody },
  impacts: { marginTop: 12, gap: 8 },
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  impactText: { flex: 1, fontSize: 13, fontWeight: '600', color: color.text },
  more: { fontSize: 13, fontWeight: '600', color: color.text },
  direction: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  directionText: { fontSize: 11, fontWeight: '700' },
  benefit: { backgroundColor: color.benefitSoft }, benefitText: { color: color.benefit },
  damage: { backgroundColor: color.damageSoft }, damageText: { color: color.damage },
  related: { backgroundColor: color.primarySoft }, relatedText: { color: color.primaryText },
  rankLayout: { flexDirection: 'row', gap: 14 },
  rank: { width: 18, fontSize: 17, fontWeight: '700', color: color.text, paddingTop: 30, textAlign: 'center' },
  rankBody: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  company: { backgroundColor: color.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  companyText: { fontSize: 12, color: color.primaryText },
});
