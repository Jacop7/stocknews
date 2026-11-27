import type { PublicArticleBody } from '@judoju/contracts';
const sourceGroups=[['PRIMARY','1차 출처 (회사·당국 발표)'],['REPORTED','보도 출처'],[undefined,'뉴스 출처']] as const;
const disclaimer='본 콘텐츠는 정보 제공 목적의 분석이며 투자 권유가 아닙니다. 투자 판단과 책임은 이용자에게 있습니다.';
// One "연관 섹터" area: clear benefit and damage sectors only, each box with a 수혜/피해 badge (same as the app).
const sections=[['BENEFIT_SECTORS','BENEFIT'],['DAMAGE_SECTORS','DAMAGE']] as const;
const badge=(x:PublicArticleBody['impacts'][number])=>x.direction==='BENEFIT'?['수혜','POSITIVE']:['피해','NEGATIVE'];
export function ArticlePreview({title,summary,body}:{title:string;summary:string;body:PublicArticleBody}){
 return <article className='article-preview'><span className='tag'>합성 기사 · 실제 투자 정보 아님</span><h2>{title}</h2><p>{summary}</p><section><h3>핵심 이슈</h3>{body.key_issues.map((x,n)=><p key={n}>{x}</p>)}</section><section><h3>이슈 분석</h3><p>{body.issue_analysis}</p></section>
 {body.visible_sections.includes('SCENARIOS')&&<section><h3>예상 시나리오</h3>{body.scenarios?.map(x=><div className='scenario' key={x.direction}><h4><span className={'scenario-badge '+x.direction}>{x.direction==='POSITIVE'?'긍정':'부정'}</span>{x.title}</h4><p><strong>예상결과</strong> {x.expected_result}</p><p><strong>체크사항</strong> {x.checks.join(' · ')}</p></div>)}</section>}
 {sections.some(([key])=>body.visible_sections.includes(key))&&<section><h3>연관 섹터</h3>{sections.filter(([key])=>body.visible_sections.includes(key)).flatMap(([,direction])=>body.impacts.filter(x=>x.direction===direction)).map(x=><div className='scenario' key={x.sector_id+x.path_id}><h4>{x.sector_name}<span className={'scenario-badge '+badge(x)[1]}>{badge(x)[0]}</span></h4><p>{x.description}</p>{x.conditions.length>0&&<p>조건 · {x.conditions.join(' · ')}</p>}{(x.companies?.length??0)>0&&<p className='company-pills'>{x.companies!.map(c=><span className='company-pill' key={c.source_company_ref}><strong>{c.name}</strong></span>)}</p>}</div>)}</section>}
 {body.visible_sections.includes('RISKS')&&<section><h3>리스크 체크리스트</h3>{body.risks?.map((x,n)=><p key={n}><span className='caution'>주의</span> {x}</p>)}</section>}
 {body.visible_sections.includes('SCHEDULE')&&<section><h3>주요 일정</h3>{body.schedule?.map((x,n)=><p key={n}><strong>{x.title}</strong><br/>{x.kind==='PERIOD'?x.period_label+(x.date_note?' · '+x.date_note:''):x.event_at} ({x.timezone})</p>)}</section>}
 {sourceGroups.map(([role,label])=>{const items=body.sources.filter(x=>x.role===role);return items.length>0&&<section key={label}><h3>{label}</h3>{items.map((x,n)=><p key={n}>{/^https:\/\//i.test(x.url)?<a href={x.url} target='_blank' rel='noopener noreferrer'>{x.name}</a>:x.name}{role?'':' · 합성 검증 근거'}</p>)}</section>;})}
 <section><p className='disclaimer'>{disclaimer}</p></section></article>;
}
