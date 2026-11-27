'use client';
// Publish stage 1A: evidence of an AI draft, read from the database's immutable origin record (not the editable draft).
// The draft's own version and, while the editor holds the draft, the newest pending version are shown apart.
import type { AiOrigin, AiOriginVersion } from '../lib/editor-types';

function Version({ title, value }: { title: string; value: AiOriginVersion }) {
  return <div className='edit-group'>
    <h3>{title} · AI 버전 {value.ai_version}</h3>
    <ul>{value.facts.map(fact => <li key={fact.id}>
      <strong>{fact.statement}</strong>
      <span> · {fact.verification_class === 'SENSITIVE_UNCONFIRMED' ? '미확인(게시 불가)' : fact.verification_class === 'SYSTEMIC_MACRO' ? '거시' : '일반 사실'}
        {fact.independently_verified ? ' · 독립 검증 통과' : ' · 독립 검증 없음'}{fact.korea_path_verified ? ' · 한국 경로 확인' : ''}</span>
      <div>{fact.source_urls.map(url => <a key={url} href={url} target='_blank' rel='noreferrer noopener'>{new URL(url).hostname}</a>)}</div>
    </li>)}</ul>
    <p>출처: {value.sources.map(source => <a key={source.url} href={source.url} target='_blank' rel='noreferrer noopener'>{source.name} ({source.role === 'PRIMARY' ? '공시 원문' : '보도'})</a>)}</p>
  </div>;
}

// Publish stage 1C: the newest held version can be adopted when the server says so (it re-checks everything).
export default function AiOriginPanel({ origin, onAdopt, disabled = false }: { origin: AiOrigin; onAdopt?: (version: number) => void; disabled?: boolean }) {
  return <section className='panel' aria-label='AI 초안 근거'>
    <h2>AI 초안 근거</h2>
    <p>원문 본문은 저장하지 않습니다. 사실 문장과 출처 링크만 보관하며, 30일 뒤 정리됩니다.{origin.link_state === 'HOLD_EDITOR' ? ' 편집자가 수정한 초안이라 새 AI 버전은 아래에 따로 보관합니다.' : ''}</p>
    {origin.draft && <Version title='이 초안의 근거' value={origin.draft} />}
    {origin.pending && <Version title='새로 들어온 근거(초안에 반영 안 됨)' value={origin.pending} />}
    {origin.pending && origin.adoptable === true && onAdopt && <button className='primary' disabled={disabled} onClick={() => {
      const version = origin.pending!.ai_version;
      if (window.confirm(`초안 내용이 AI 버전 ${version}으로 바뀝니다. 직접 고친 내용은 사라집니다. 게시 중이면 공개에서 내려가고, 다시 게시해야 합니다.`)) onAdopt(version);
    }}>이 버전 채택</button>}
  </section>;
}
