import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {createHash} from 'node:crypto';
import { collectHtmlList, htmlListVersion, parseHtmlList, parseOriginalTitle } from '../scripts/providers/html-list.mjs';

const listUrl = 'https://publisher.example/news/';
const digest = title=>createHash('sha256').update(title).digest('hex');

test('Hanwha public report navigation is category-bound, numeric and confirmed in its exact title field',()=>{
  const company='https://www.hanwhawm.com/main/research/main/list.cmd?depth3_id=anls1';
  const industry='https://www.hanwhawm.com/main/research/main/list.cmd?depth3_id=anls2&viewclass=';
  const mark=(category,label,id='67017')=>`<div class="tit ${category}"><a href="javascript:view('${id}', '${category}', '${label}');">Report title</a></div>`;
  const options={includeOfficialReports:true};
  const items=parseHtmlList(mark('anls1','기업분석'),company,524288,options).candidates;
  assert.deepEqual(items,[{url:'https://www.hanwhawm.com/main/research/main/view.cmd?depth3_id=anls1&mode=&seq=67017&p=&templet=default',title:'Report title',publishedAt:null}]);
  assert.equal(parseHtmlList(mark('anls2','산업분석'),industry,524288,options).candidates.length,1);
  assert.equal(parseHtmlList(mark('anls1','기업분석'),company).candidates.length,0);
  for(const bad of [mark('anls2','산업분석'),mark('anls1','산업분석'),mark('anls1','기업분석','1x'),
    mark('anls1','기업분석').replace(';',';alert(1);'),mark('anls1','기업분석').replace('class="tit anls1"','class="footer"')])
    assert.equal(parseHtmlList(bad,company,524288,options).candidates.length,0);
  const original='<div class="researchTit"><div>Report title</div><p>Byline</p></div><div>Other report</div>';
  assert.equal(parseOriginalTitle(original,items[0].url,digest('Report title')),'Report title');
  assert.equal(parseOriginalTitle(original,items[0].url,digest('Other report')),null);
  assert.equal(parseOriginalTitle(original,items[0].url.replace('seq=67017','seq=bad'),digest('Report title')),null);
  assert.equal(parseOriginalTitle(original.replace('researchTit','other'),items[0].url,digest('Report title')),null);
  assert.equal(parseOriginalTitle(original.replace('</p>','</p><div>Report title</div>'),items[0].url,digest('Report title')),null);
  const wrong='<div class="researchTit"><div>Other report</div></div>';
  assert.equal(parseOriginalTitle(wrong+'<main><h1>Report title</h1></main>',items[0].url,digest('Report title')),null);
  assert.equal(parseOriginalTitle(wrong+'<meta property="og:type" content="article"><meta property="og:title" content="Wrong OG"><h1>Wrong OG</h1>',items[0].url,digest('Report title')),null);
});

test('accepts only the same HTTPS article when a publisher declares an HTTP canonical',()=>{
  const original='https://www.hansbiz.co.kr/news/articleView.html?idxno=42';
  const body='<meta property="og:type" content="article"><meta property="og:title" content="Confirmed headline"><h3>Confirmed headline</h3>';
  const parse=c=>parseOriginalTitle(`<link rel="canonical" href="${c}">`+body,original,digest('Confirmed headline'));
  assert.equal(parse('http://www.hansbiz.co.kr/news/articleView.html?idxno=42'),'Confirmed headline');
  for(const bad of ['http://www.hansbiz.co.kr/news/articleView.html?idxno=43','http://evil.example/news/articleView.html?idxno=42',
    'http://www.hansbiz.co.kr:8080/news/articleView.html?idxno=42','http://user@www.hansbiz.co.kr/news/articleView.html?idxno=42'])assert.equal(parse(bad),null);
});

test('decodes only observed numeric report navigation and confirms the original title field',()=>{
  const source='https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1800';
  const markup=`<table><tr><td class="left"><div class="subject"><a id="bbsTitle0" href="javascript:view('2344449','1054')"><b>LS</b><br><span>Growth report</span></a>
    <a id="bbsTitle1" href="javascript:view('2344449','1054');alert(1)">Injected</a></div></td></tr></table>`;
  const items=parseHtmlList(markup,source,524288,{includeOfficialReports:true}).candidates;
  assert.deepEqual(items,[{url:'https://securities.miraeasset.com/bbs/board/message/view.do?categoryId=1800&messageId=2344449&messageNumber=1054',title:'LSGrowth report',publishedAt:null}]);
  assert.equal(parseHtmlList(markup,source).candidates.length,0);
  const original='<table><tr><th class="bbs_detailTitle"><h4>LS<span>Growth report</span></h4></th></tr></table>';
  assert.equal(parseOriginalTitle(original,items[0].url,digest(items[0].title)),items[0].title);
  assert.equal(parseOriginalTitle(original,items[0].url,digest('Other report')),null);
  const kyobo='https://www.iprovest.com/weblogic/RSReportServlet?scr_id=40&mode=detail&menuCode=9&sno=2053773';
  const kyoboHtml='<table><tr><th>제목</th><td>Industry report</td></tr><tr><th>이전글</th><td>Other report</td></tr></table>';
  assert.equal(parseOriginalTitle(kyoboHtml,kyobo,digest('Industry report')),'Industry report');
  assert.equal(parseOriginalTitle(kyoboHtml,kyobo,digest('Other report')),null);
});

test('distinguishes Heungkuk report links and title cells from analyst links and body text',()=>{
  const source='https://www.heungkuksec.co.kr/research/company/list.do';
  const markup=`<table><tr><td class="left"><a href="#" onclick="nav.go('view', 'key=21963');">Research title</a></td>
    <td><a href="../analyst/view.do?key=1">Analyst</a></td></tr></table>`;
  const items=parseHtmlList(markup,source,524288,{includeOfficialReports:true}).candidates;
  assert.deepEqual(items,[{url:'https://www.heungkuksec.co.kr/research/company/view.do?key=21963',title:'Research title',publishedAt:null}]);
  const original='<table class="data_list_x"><tr><td class="left col_b669ad">Research title</td></tr><tr><td>Body</td></tr></table>';
  assert.equal(parseOriginalTitle(original,items[0].url,digest('Research title')),'Research title');
  assert.equal(parseOriginalTitle(original,items[0].url,digest('Body')),null);
});

test('Yahoo discovery selects topic story headings and excludes external, video and unrelated modules',()=>{
  const tags=JSON.stringify({yModuleName:'topic-stream',yContentType:'story'});
  const card=(path,meta=tags)=>`<a data-yga='${meta}' href='${path}'><h3>Market headline</h3></a>`;
  const html=card('/markets/stocks/articles/market-move-123456789.html')+
    card('https://evil.example/news/market-123456789.html')+card('/video/clip-123456789.html')+
    card('/news/market-123456789.html',JSON.stringify({yModuleName:'nav',yContentType:'story'}));
  assert.deepEqual(parseHtmlList(html,'https://finance.yahoo.com/topic/latest-news/').candidates,
    [{url:'https://finance.yahoo.com/markets/stocks/articles/market-move-123456789.html',title:'Market headline',publishedAt:null}]);
});

test('Yahoo syndications require a matching visible title, listing fingerprint and self URL',()=>{
  const url='https://finance.yahoo.com/markets/stocks/articles/market-move-123456789.html';
  const page='<link rel="canonical" href="https://publisher.example/original"><meta property="og:type" content="article">'+
    '<meta property="og:title" content="Market move">'+`<meta property="og:url" content="${url}"><main><h1>Market move</h1></main>`;
  assert.equal(parseOriginalTitle(page,url,digest('Market move')),'Market move');
  assert.equal(parseOriginalTitle(page,url,digest('Different title')),null);
  assert.equal(parseOriginalTitle(page.replace('<h1>Market move</h1>',''),url,digest('Market move')),null);
  assert.equal(parseOriginalTitle(page.replace(`content="${url}"`,'content="https://finance.yahoo.com/wrong"'),url,digest('Market move')),null);
  for(const wrong of ['https://finance.yahoo.com/news/different-123456789.html','http://finance.yahoo.com/news/different-123456789.html','https://news.yahoo.com/news/different-123456789.html'])
    assert.equal(parseOriginalTitle(page.replace('https://publisher.example/original',wrong),url,digest('Market move')),null);
});

test('data center news list excludes event and navigation cards',()=>{
  const c=path=>`<article><h1><a href='${path}'>Data center event</a></h1></article>`;
  const items=parseHtmlList(c('/en/dcdconnect-live/india/2027/')+c('/en/news/new-data-center/'),
    'https://www.datacenterdynamics.com/en/news/').candidates;
  assert.deepEqual(items,[{url:'https://www.datacenterdynamics.com/en/news/new-data-center/',title:'Data center event',publishedAt:null}]);
});

test('Focus Taiwan confirms its real div-based h1 despite the publisher suffix in metadata',()=>{
  const url='https://focustaiwan.tw/business/202611200021';
  const page=`<link rel="canonical" href="${url}"><meta property="og:type" content="article">`+
    '<meta property="og:title" content="Export orders - Focus Taiwan"><div><h1>Export orders</h1></div>';
  assert.equal(parseOriginalTitle(page,url,digest('Export orders')),'Export orders');
  assert.equal(parseOriginalTitle(page,url,digest('Wrong title')),null);
  assert.equal(parseOriginalTitle(page.replace('rel="canonical"','rel="other"'),url,digest('Export orders')),null);
  assert.equal(parseOriginalTitle(page.replace('content="article"','content="website"'),url,digest('Export orders')),null);
});
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
