import { Text } from 'react-native';
import type { PublicHomePage } from '@judoju/contracts';
import { Screen } from '../../components/Screen';
import { RankedCard } from '../../components/NewsCard';
import { StatusMessage } from '../../components/NewsFeed';
import { formatKstDateTime } from '../../components/format';
import { usePublicRead } from '../../data/public-read';
import { color } from '../../theme';

// 홈: the current 5-minute ranking snapshot (lanes A → B → C, one card per story).
export default function Home() {
  const home = usePublicRead<PublicHomePage>('/v2/home');
  const cards = home.data ? [...home.data.lanes.A, ...home.data.lanes.B, ...home.data.lanes.C] : [];
  return (
    <Screen title='홈' variant='brand'>
      {home.data?.ranking_cutoff && (
        <Text style={{ fontSize: 12, color: color.textMuted, textAlign: 'right', marginBottom: 8 }}>
          {formatKstDateTime(home.data.ranking_cutoff)} 기준{home.data.state === 'DELAYED' ? ' · 지연' : ''}
        </Text>
      )}
      {home.loading && !home.data && <StatusMessage text='주요 이슈를 확인하고 있습니다.' />}
      {Boolean(home.error) && <StatusMessage text={home.error} actionLabel='다시 확인' onAction={home.retry} />}
      {home.data?.state === 'CALCULATING' && <StatusMessage text='순위를 계산하고 있습니다. 잠시 후 다시 확인해 주세요.' />}
      {home.data && home.data.state !== 'CALCULATING' && cards.length === 0 && <StatusMessage text='지금 표시할 주요 이슈가 없습니다.' />}
      {cards.map((card, index) => <RankedCard key={card.issue_id} rank={index + 1} article={card} />)}
    </Screen>
  );
}
