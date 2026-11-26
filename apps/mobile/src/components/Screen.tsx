import { Link, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { color, layout, radius } from '../theme';
import { Icon } from './Icon';

type Variant = 'brand' | 'saved' | 'back';

export function HeaderButton({ label, onPress, children }: { label: string; onPress?: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole='button' accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.headerButton}>
      {children}
    </Pressable>
  );
}

function BrandHeader() {
  return (
    <View style={styles.header}>
      <Link href='/' accessibilityLabel='주도주뉴스 홈'>
        <View style={styles.logoRow}>
          <Text style={styles.logo}>주도주</Text>
          <View style={styles.logoBadge}><Text style={styles.logoBadgeText}>뉴스</Text></View>
        </View>
      </Link>
      <Link href='/search' asChild>
        <Pressable accessibilityRole='button' accessibilityLabel='뉴스·종목 검색' hitSlop={8} style={styles.headerButton}>
          <Icon name='search' size={23} />
        </Pressable>
      </Link>
    </View>
  );
}

function SavedHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.pageTitle}>{title}</Text>
      <View style={styles.actions}>
        <Link href='/notifications' asChild>
          <Pressable accessibilityRole='button' accessibilityLabel='알림' hitSlop={8} style={styles.headerButton}><Icon name='bell' size={23} strokeWidth={1.7} /></Pressable>
        </Link>
        <Link href='/settings' asChild>
          <Pressable accessibilityRole='button' accessibilityLabel='설정' hitSlop={8} style={styles.headerButton}><Icon name='settings' size={23} strokeWidth={1.7} /></Pressable>
        </Link>
      </View>
    </View>
  );
}

export function BackHeader({ title, actions, fallback = '/' }: { title: string; actions?: ReactNode; fallback?: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <HeaderButton label='뒤로' onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}>
        <Icon name='back' size={21} />
      </HeaderButton>
      <Text style={styles.backTitle} numberOfLines={1}>{title}</Text>
      <View style={[styles.actions, styles.backActions]}>{actions}</View>
    </View>
  );
}

export function Screen({ title, children, variant, saved = false, header, actions, scroll = true, contentStyle }: {
  title: string;
  children: ReactNode;
  variant?: Variant;
  /** @deprecated use variant='saved' */
  saved?: boolean;
  header?: ReactNode;
  actions?: ReactNode;
  scroll?: boolean;
  contentStyle?: object;
}) {
  const kind: Variant = variant ?? (saved ? 'saved' : 'back');
  const top = header ?? (kind === 'brand' ? <BrandHeader /> : kind === 'saved' ? <SavedHeader title={title} /> : <BackHeader title={title} actions={actions} />);
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      {top}
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={[styles.content, contentStyle]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  fill: { flex: 1 },
  header: {
    minHeight: 58, paddingHorizontal: layout.gutter, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.border, gap: 8,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  logo: { fontSize: 22, fontWeight: '800', color: color.primary, letterSpacing: -0.5 },
  logoBadge: { backgroundColor: color.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  logoBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pageTitle: { fontSize: 20, fontWeight: '700', color: color.text },
  backTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: color.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backActions: { minWidth: 40, justifyContent: 'flex-end' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: layout.gutter, paddingBottom: 40, maxWidth: layout.maxWidth, width: '100%', alignSelf: 'center' },
});

// Shared text/surface styles used across screens.
export const s = StyleSheet.create({
  root: styles.root,
  header: styles.header,
  logo: styles.logo,
  logoBadge: styles.logoBadgeText,
  actions: styles.actions,
  action: { fontSize: 22, color: color.textBody },
  content: styles.content,
  notice: { fontSize: 12, color: color.textMuted, marginBottom: 16 },
  title: { fontSize: 22, lineHeight: 31, fontWeight: '700', color: color.text, marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 22, color: color.textBody },
  card: {
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card,
    padding: 20, marginBottom: 12,
  },
  badge: { fontSize: 12, fontWeight: '600', color: color.primary, marginBottom: 8 },
  headline: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: color.text, marginBottom: 6 },
  date: { fontSize: 12, color: color.textMuted },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.surface, borderWidth: 1,
    borderColor: color.border, borderRadius: radius.chip, paddingVertical: 8, paddingHorizontal: 14,
  },
  chipText: { fontSize: 13, color: color.textBody },
  empty: {
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card,
    paddingVertical: 44, alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: color.textMuted },
});
