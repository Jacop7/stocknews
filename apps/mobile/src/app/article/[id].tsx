import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PublicArticleDetail } from '@judoju/contracts';
import { ArticleBody } from '../../components/ArticleBody';
import { StatusMessage } from '../../components/NewsFeed';
import { SaveButton } from '../../components/SaveButton';
import { Screen } from '../../components/Screen';
import { formatKstDateTime } from '../../components/format';
import { useArticleView } from '../../data/useArticleView';
import { useCurrentRead } from '../../data/useCurrentRead';
import { color } from '../../theme';

export default function Article() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const result = useCurrentRead<PublicArticleDetail>('/articles/' + encodeURIComponent(id ?? ''));
  const article = result.data;
  useArticleView(id ?? '', article, result.loading);

  // Keep only the last published height while a status recheck is pending, so the
  // scroll range does not collapse; earlier article text itself is never retained.
  const layout = useRef({ id, height: 0 });
  if (layout.current.id !== id) layout.current = { id, height: 0 };
  const published = article?.state === 'PUBLISHED' ? article : null;
  const canonical = published ? published.issue_id : (article && 'canonical_issue_id' in article ? article.canonical_issue_id : undefined) ?? id ?? '';

  return (
    <Screen
      title='이슈체크'
      contentStyle={styles.content}
      actions={<SaveButton id={id ?? ''} canonicalId={canonical} canAdd={Boolean(published)} />}
    >
      <View
        testID='article-current-content'
        style={result.loading ? { minHeight: layout.current.height } : undefined}
        onLayout={e => { if (published) layout.current = { id, height: e.nativeEvent.layout.height }; }}
      >
        {result.loading && <View style={styles.pad}><StatusMessage text='최신 게시 상태를 확인하고 있습니다.' /></View>}
        {Boolean(result.error) && <View style={styles.pad}><StatusMessage text={result.error} actionLabel='다시 확인' onAction={result.retry} /></View>}
        {article && article.state !== 'PUBLISHED' && <View style={styles.pad}><StatusMessage text={article.message} /></View>}
        {published && (
          <>
            <View style={styles.head}>
              <View style={styles.meta}>
                {published.body.article_kind === 'MACRO'
                  ? <Text style={styles.badge}>매크로</Text>
                  : published.body.impacts[0] && <Text style={styles.badge}>{published.body.impacts[0].sector_name}</Text>}
                <Text style={styles.date}>{formatKstDateTime(published.first_published_at)}</Text>
              </View>
              <Text style={styles.title}>{published.title}</Text>
              <Text style={styles.summary}>{published.summary}</Text>
            </View>
            <ArticleBody body={published.body} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 0 },
  pad: { padding: 16 },
  head: { backgroundColor: color.surface, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  badge: { backgroundColor: color.primary, color: '#fff', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  date: { fontSize: 12, color: color.textMuted, marginLeft: 'auto' },
  title: { fontSize: 21, lineHeight: 30, fontWeight: '700', color: color.text, marginBottom: 8 },
  summary: { fontSize: 14, lineHeight: 22, color: color.textBody },
});
