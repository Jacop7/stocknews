'use client';
// Publish stage 1A (A5): review and change the company scope of a draft. A COMPANY draft needs a primary company that
// is also one of its linked companies (the database checks the same rule, migration 51); companies are found through
// the catalog search the sector manager already uses.
import { useState } from 'react';

type Label = { id: string; name: string; active: boolean };
type Found = { id: string; name: string; active: boolean };

export default function CompanyScope({ kind, primary, refs, labels, disabled, onChange }: {
  kind: string; primary: string | null; refs: string[]; labels: Label[]; disabled: boolean;
  onChange: (value: { primary_company_ref: string | null; company_refs: string[] }) => void;
}) {
  const [query, setQuery] = useState(''), [found, setFound] = useState<Found[]>([]), [error, setError] = useState('');
  const [known, setKnown] = useState<Record<string, string>>(() => Object.fromEntries(labels.map(label => [label.id, label.name])));
  const name = (id: string) => known[id] ?? labels.find(label => label.id === id)?.name ?? id;
  const inactive = (id: string) => labels.some(label => label.id === id && !label.active);
  async function search() {
    setError('');
    const response = await fetch('/api/catalog/companies?q=' + encodeURIComponent(query) + '&offset=0', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (!response.ok) { setError(value.error ?? 'SEARCH_FAILED'); return; }
    setFound((value.items ?? []).slice(0, 20));
  }
  const add = (company: Found) => { setKnown({ ...known, [company.id]: company.name }); if (!refs.includes(company.id)) onChange({ primary_company_ref: primary, company_refs: [...refs, company.id] }); };
  const remove = (id: string) => onChange({ primary_company_ref: primary === id ? null : primary, company_refs: refs.filter(ref => ref !== id) });
  const missingPrimary = kind === 'COMPANY' && (!primary || !refs.includes(primary));
  return <div className='edit-group'>
    <h2>관련 기업</h2>
    {kind === 'COMPANY' && <label>대표 기업<select disabled={disabled} value={primary ?? ''} onChange={e => onChange({ primary_company_ref: e.target.value || null, company_refs: refs })}>
      <option value=''>선택 없음</option>{refs.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>}
    {missingPrimary && <p role='status'>종목 기사는 관련 기업 중 하나를 대표 기업으로 골라야 미리보기와 저장 검증을 통과합니다.</p>}
    <ul>{refs.map(id => <li key={id}>{name(id)}{inactive(id) ? ' · 비활성' : ''}{primary === id ? ' · 대표' : ''} <button type='button' disabled={disabled} onClick={() => remove(id)}>빼기</button></li>)}</ul>
    <div className='toolbar'><input aria-label='기업 검색' value={query} disabled={disabled} onChange={e => setQuery(e.target.value)} /><button type='button' disabled={disabled} onClick={() => void search()}>기업 검색</button></div>
    {error && <p role='alert'>{error}</p>}
    <ul>{found.map(company => <li key={company.id}>{company.name}{company.active ? '' : ' · 비활성'} <button type='button' disabled={disabled || refs.includes(company.id)} onClick={() => add(company)}>추가</button></li>)}</ul>
  </div>;
}
