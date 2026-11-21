import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { collectHtmlList, htmlListVersion, parseHtmlList } from '../scripts/providers/html-list.mjs';

const listUrl = 'https://publisher.example/news/';
const structured = {
  '@type': 'ItemList',
  itemListElement: [
    { '@type':'ListItem', item:{ '@type':'NewsArticle', url:'/articles/11?utm_source=search',
      headline:'공시 확인', datePublished:'2026-11-20T21:00:00+09:00' } },
    { '@type':'ListItem', item:{ '@type':'NewsArticle', url:'https://elsewhere.example/article', headline:'외부' } },
  ],
};
const html = `
  <script type="application/ld+json">${JSON.stringify(structured)}</script>
  <!-- <article><h2><a href="/fake">댓글</a></h2></article> -->
  <noscript><article><h2><a href="/fallback">대체 영역</a></h2></article></noscript>
  <article><h2><a href="/articles/11">중복</a></h2></article>
  <article><h2><a href="/articles/12"><span>테스트 &amp; 검증</span></a></h2><time datetime="2026-02-30T10:00:00Z"></time></article>
  <article><h2><a href="javascript:alert(1)">실행 안 함</a></h2></article>
`;

function eligible() {
  const endpoint = {
    endpoint_id: 'fixture-news', permission_profile_id: 'fixture-permission', permission_profile_version: '1',
    status: 'TECH_TEST', url: listUrl, adapter_version: htmlListVersion,
    enabled_scopes: ['DISCOVERY','MACHINE_ACCESS','LINK_EXTRACTION'],
  };
  const profile = {
    id: 'fixture-permission', endpoint_id: 'fixture-news', version: '1', status: 'VERIFIED', evidence: ['fixture-only'],
    verified_at: '2026-11-19T00:00:00Z', expires_at: '2026-11-21T00:00:00Z',
    purposes: {DISCOVERY:'ALLOW', MACHINE_ACCESS:'ALLOW', LINK_EXTRACTION:'ALLOW'}, timeout_ms: 1000, max_bytes: 32_768,
    max_requests: 1, methods: ['GET'], allowed_hosts: ['publisher.example'],
  };
  return { endpoint, profile, now: ()=>'2026-11-20T12:00:00Z', lookupHost:async()=>[{address:'93.184.215.14',family:4}] };
}

test('extracts structured and marked-up same-site articles and deduplicates tracking URLs', () => {
  assert.deepEqual(parseHtmlList(html, listUrl), {truncated:false,candidates:[
    {url:'https://publisher.example/articles/11',title:'공시 확인',publishedAt:'2026-11-20T12:00:00.000Z'},
    {url:'https://publisher.example/articles/12',title:'테스트 & 검증',publishedAt:null},
  ]});
  const more = Array.from({length:101}, (_, i)=>`<article><h2><a href="/articles/${i}">기사 ${i}</a></h2></article>`).join('');
  const limited = parseHtmlList(more, listUrl);
  assert.equal(limited.truncated, true);
  assert.equal(limited.candidates.length, 100);
});

test('reads public market cards while excluding navigation, paid menus and unrelated categories', () => {
  const focus = `<nav><a href="/business/202611200021">nav</a></nav><ul id="jsList">
    <li><a href="/business/202611200021"><div class="listInfo"><h2>AI export orders</h2><span>summary</span></div></a></li>
    <li><a href="/politics/202611200022"><h2>Unrelated politics</h2></a></li>
    <li><a href="https://evil.example/business/202611200023"><h2>Outside site</h2></a></li></ul>`;
  assert.deepEqual(parseHtmlList(focus, 'https://focustaiwan.tw/business').candidates,
    [{url:'https://focustaiwan.tw/business/202611200021',title:'AI export orders',publishedAt:null}]);
  const cards = `<a class="Card-title" href="/2026/11/12/misplaced.html">Outside cards</a>
    <div class="Card-titleContainer"><div><a class="Card-title" href="/2026/11/12/earnings.html">Earnings beat</a></div>
    <a class="Card-title" href="/pro/news/">Pro news</a>
    <a class="Card-title" href="https://evil.example/2026/11/12/bad.html">External</a></div>`;
  for(const url of ['https://www.cnbc.com/markets/','https://www.cnbc.com/earnings/'])
    assert.deepEqual(parseHtmlList(cards,url).candidates,
      [{url:'https://www.cnbc.com/2026/11/12/earnings.html',title:'Earnings beat',publishedAt:null}]);
  assert.equal(parseHtmlList(cards,'https://www.cnbc.com/pro/').candidates.length,0);
});

test('resolves document base and reads headings within a linked card or after an unlinked subheading', () => {
  const linkedCard = '<article><a href="daily"><h2>오늘의 이슈</h2><span>태그</span></a></article>';
  const lateHeading = '<article><h3>증권</h3><h2><a href="market">장 마감</a></h2></article>';
  assert.deepEqual(parseHtmlList('<base href="/articles/">'+linkedCard+lateHeading,listUrl).candidates,[
    {url:'https://publisher.example/articles/daily',title:'오늘의 이슈',publishedAt:null},
    {url:'https://publisher.example/articles/market',title:'장 마감',publishedAt:null},
  ]);
  assert.deepEqual(parseHtmlList('<base href="https://elsewhere.example/">'+linkedCard,listUrl).candidates,[]);
});

test('published title lists select article links, excluding sidebar, navigation, and different origins', () => {
  const hankyung = `
    <ul class="news-list"><li><h2 class="news-tit"><a href="/article/2026112088476">기업 기사</a></h2></li>
      <li><h2 class="news-tit"><a href="/koreamarket/1114?page=2">다음 페이지</a></h2></li>
      <li><h2 class="news-tit"><a href="https://other.example/article/2026112088477">다른 매체</a></h2></li>
      <li><figure><a href="/article/2026112088476"><img src="/img.png"></a></figure></li>
    </ul><aside><h2 class="news-tit"><a href="/article/2026112088478">많이 읽은 기사</a></h2></aside>`;
  for (const section of ['1113', '1114']) {
    assert.deepEqual(parseHtmlList(hankyung, 'https://www.hankyung.com/koreamarket/' + section).candidates, [
      { url: 'https://www.hankyung.com/article/2026112088476', title: '기업 기사', publishedAt: null },
    ]);
  }
  assert.deepEqual(parseHtmlList(hankyung, 'https://www.hankyung.com/koreamarket/9999').candidates, []);

  const htmlWithTracking = `<div class="sub_n_list_cont"><div class="cluster_text_headline21">
    <a href="/news/view/2646621?trc=sub_list_news">특징주</a>
    <a href="/news/view/2646621?trc=other">중복</a></div></div>`;
  assert.deepEqual(parseHtmlList(htmlWithTracking, 'https://www.etoday.co.kr/market/hot-stock').candidates, [
    { url: 'https://www.etoday.co.kr/news/view/2646621', title: '특징주', publishedAt: null },
  ]);
});

test('query-based detail links preserve article ID and avoid summary or pagination links', () => {
  const han = `<section id="section-list"><h4 class="titles">
    <a href="/news/articleView.html?idxno=885049">공시 제목</a>
    <a href="/news/articleView.html?idxno=7&amp;idxno=8">모호한 주소</a></h4>
    <p class="lead"><a href="/news/articleView.html?idxno=885049">기사 요약</a></p></section>`;
  assert.deepEqual(parseHtmlList(han, 'https://www.hansbiz.co.kr/news/articleList.html?sc_section_code=S1N54&view_type=sm').candidates, [
    { url: 'https://www.hansbiz.co.kr/news/articleView.html?idxno=885049', title: '공시 제목', publishedAt: null },
  ]);
});

test('all 112 registered endpoints start with no HTML network dispatch', async () => {
  const data = name=>JSON.parse(readFileSync(new URL('../data/providers/'+name,import.meta.url),'utf8'));
  const {endpoints} = data('routes.json');
  const profiles = new Map(data('permission-profiles.json').profiles.map(profile=>[profile.id,profile]));
  let calls = 0;
  assert.equal(endpoints.length, 112);
  for (const endpoint of endpoints) {
    const result = await collectHtmlList({endpoint,profile:profiles.get(endpoint.permission_profile_id),execute:true,
      transport:async()=>{calls++;throw new Error('unexpected request');}});
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.requests, 0);
  }
  assert.equal(calls, 0);
});

test('only an enabled, approved adapter parses a single fixture listing; a denied or non-HTML response stays empty', async () => {
  const input = eligible();
  let calls = 0;
  const fetchList = async (url, limits)=>{
    assert.equal(url,listUrl);
    assert.deepEqual(limits.resolvedAddresses,[{address:'93.184.215.14',family:4}]);
    calls++;
    return {status:200,contentType:'text/html; charset=UTF-8',body:Buffer.from(html)};
  };
  assert.equal((await collectHtmlList({...input,transport:fetchList})).status,'DRY_RUN');
  assert.equal((await collectHtmlList({...input,endpoint:{...input.endpoint,enabled_scopes:[]},execute:true,transport:fetchList})).status,'BLOCKED');
  const withoutLinkExtraction = {...input.profile,purposes:{...input.profile.purposes,LINK_EXTRACTION:'DENY'}};
  assert.equal((await collectHtmlList({...input,profile:withoutLinkExtraction,execute:true,transport:fetchList})).status,'BLOCKED');
  assert.equal(calls,0);
  const result = await collectHtmlList({...input,execute:true,transport:fetchList});
  assert.equal(result.status,'CANDIDATES');
  assert.equal(result.requests,1);
  assert.equal(result.candidates.length,2);
  assert.equal(calls,1);
  for (const status of [403,429,302]) {
    const denied = await collectHtmlList({...input,execute:true,
      transport:async()=>({status,contentType:'text/html',body:Buffer.from(html),location:'/other'})});
    assert.equal(denied.status,status === 302 ? 'FAILED' : 'HTTP_FAILED');
    assert.equal(denied.requests,1);
    assert.deepEqual(denied.candidates,[]);
  }
  const noHtml = await collectHtmlList({...input,execute:true,
    transport:async()=>({status:200,contentType:'application/json',body:Buffer.from(html)})});
  assert.equal(noHtml.status,'PARSE_HOLD');
  assert.deepEqual(noHtml.candidates,[]);
});

test('discards candidates if authorization changes while the response is in flight', async () => {
  const input = eligible();
  const result = await collectHtmlList({...input,execute:true,transport:async()=>{
    input.profile.revoked_at = input.now();
    return {status:200,contentType:'text/html',body:Buffer.from(html)};
  }});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.requests,1);
  assert.deepEqual(result.candidates,[]);
});

test('does not dispatch if authorization changes during DNS resolution', async () => {
  for (const mutation of [input=>{input.profile.revoked_at=input.now();}, input=>{input.profile.methods=[];}]) {
    const input = eligible();
    let calls = 0;
    const result = await collectHtmlList({...input,execute:true,lookupHost:async(...args)=>{
      mutation(input);
      return input.lookupHost(...args);
    },transport:async()=>{calls++;throw new Error('unexpected request');}});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.requests,0);
    assert.equal(calls,0);
  }
});

test('discards a response when the permitted host or size changes during the fetch', async () => {
  for (const mutation of [profile=>{profile.allowed_hosts=[];},profile=>{profile.max_bytes=8;}]) {
    const input = eligible();
    const result = await collectHtmlList({...input,execute:true,transport:async()=>{
      mutation(input.profile);
      return {status:200,contentType:'text/html',body:Buffer.from(html)};
    }});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.requests,1);
    assert.deepEqual(result.candidates,[]);
  }
});
