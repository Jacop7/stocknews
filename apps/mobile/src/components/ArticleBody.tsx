import { StyleSheet, Text, View } from 'react-native';
import type { PublicArticleBody, PublicImpact } from '@judoju/contracts';
import { color, radius } from '../theme';

const impactSections = [
  ['BENEFIT_SECTORS', '수혜 섹터', 'BENEFIT'],
  ['DAMAGE_SECTORS', '피해 섹터', 'DAMAGE'],
  ['RELATED_SECTORS', '연관 섹터', 'RELATED'],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={a.section}>
      <Text style={a.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Tag({ tone, label }: { tone: 'positive' | 'negative' | 'caution'; label: string }) {
  return <Text style={[a.tag, a[tone]]}>{label}</Text>;
}

function ImpactItem({ impact }: { impact: PublicImpact }) {
  return (
    <View style={a.impact}>
      <Text style={a.itemTitle}>{impact.sector_name}</Text>
      <Text style={a.body}>{impact.description}</Text>
      {impact.conditions.length > 0 && <Text style={[a.body, a.conditions]}>조건 · {impact.conditions.join(' · ')}</Text>}
      {Boolean(impact.companies?.length) && (
        <View style={a.chips}>
          {impact.companies!.map(name => <View key={name} style={a.company}><Text style={a.companyText}>{name}</Text></View>)}
        </View>
      )}
    </View>
  );
}

// Section visibility comes from the server (visible_sections); the app never infers it.
export function ArticleBody({ body }: { body: PublicArticleBody }) {
  const visible = (key: PublicArticleBody['visible_sections'][number]) => body.visible_sections.includes(key);
  return (
    <>
      <Section title='핵심 이슈'>
        {body.key_issues.map((x, n) => (
          <View key={n} style={a.keyIssue}><Text style={a.keyIssueText}>{x}</Text></View>
        ))}
        <Text style={[a.body, { marginTop: 8 }]}>{body.issue_analysis}</Text>
      </Section>

      {visible('SCENARIOS') && Boolean(body.scenarios?.length) && (
        <Section title='예상 시나리오'>
          {body.scenarios!.map(x => (
            <View key={x.direction + x.title} style={a.box}>
              <View style={a.boxTitle}>
                <Tag tone={x.direction === 'NEGATIVE' ? 'negative' : 'positive'} label={x.direction === 'POSITIVE' ? '긍정' : '부정'} />
                <Text style={a.itemTitle}>{x.title}</Text>
              </View>
              <Text style={a.body}>예상 결과 · {x.expected_result}</Text>
              <Text style={a.body}>확인 사항 · {x.checks.join(' · ')}</Text>
            </View>
          ))}
        </Section>
      )}

      {impactSections.map(([key, label, direction]) => visible(key) && (
        <Section key={key} title={label}>
          {body.impacts.filter(x => x.direction === direction).map(x => <ImpactItem key={x.sector_id + x.path_id} impact={x} />)}
        </Section>
      ))}

      {visible('RISKS') && Boolean(body.risks?.length) && (
        <Section title='리스크 체크리스트'>
          {body.risks!.map((x, n) => (
            <View key={n} style={a.boxTitle}><Tag tone='caution' label='주의' /><Text style={[a.body, { flex: 1 }]}>{x}</Text></View>
          ))}
        </Section>
      )}

      {visible('SCHEDULE') && Boolean(body.schedule?.length) && (
        <Section title='주요 일정'>
          {body.schedule!.map((x, n) => (
            <View key={n} style={a.impact}>
              <Text style={a.itemTitle}>{x.title}</Text>
              <Text style={a.body}>
                {x.kind === 'PERIOD'
                  ? x.period_label + (x.date_note ? ' · ' + x.date_note : '')
                  : new Date(x.event_at ?? '').toLocaleString('ko-KR', { timeZone: x.timezone })}
              </Text>
              <Text style={a.meta}>{x.timezone}</Text>
            </View>
          ))}
        </Section>
      )}

      <View style={[a.section, a.sources]}>
        <Text style={a.sectionTitle}>뉴스 출처</Text>
        {body.sources.map((x, n) => <Text key={n} style={a.body}>{x.name}</Text>)}
      </View>
    </>
  );
}

const a = StyleSheet.create({
  section: { backgroundColor: color.surface, paddingHorizontal: 20, paddingVertical: 22, marginTop: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: color.textBody, marginBottom: 14 },
  body: { fontSize: 14, lineHeight: 22, color: color.textBody },
  meta: { fontSize: 12, color: color.textMuted, marginTop: 4 },
  itemTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: color.text, flexShrink: 1 },
  keyIssue: { borderWidth: 1, borderColor: color.border, borderRadius: 12, padding: 14, marginBottom: 8 },
  keyIssueText: { fontSize: 15, fontWeight: '600', color: color.text, lineHeight: 22 },
  box: { borderWidth: 1, borderColor: color.border, borderRadius: 12, padding: 14, marginBottom: 10, gap: 4 },
  boxTitle: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  impact: { marginBottom: 18 },
  conditions: { marginTop: 2, color: color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  company: { backgroundColor: color.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  companyText: { fontSize: 12, color: color.primaryText },
  tag: { fontSize: 11, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' },
  positive: { backgroundColor: color.benefitSoft, color: color.benefit },
  negative: { backgroundColor: color.damageSoft, color: color.damage },
  caution: { backgroundColor: color.cautionSoft, color: color.caution },
  sources: { backgroundColor: '#fafafb', borderRadius: radius.small },
});
