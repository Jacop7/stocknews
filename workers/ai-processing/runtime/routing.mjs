// Link routing by destination host (2026-11-26, user decision B).
// - REDIRECT: short links and aggregator redirects; resolved to their destination first (no body read).
// - EVIDENCE: hosts registered as OFFICIAL or REPORT sources; read as originals when their grant is enabled.
// - SIGNAL: news and everything else; never read, kept only as a ranking/discovery signal (host, URL, times).
// - IRRELEVANT: shops, video, social, app stores; dropped.
// Kept in one place so the candidate generator and the processing pipeline agree.
export const REDIRECT_HOSTS = new Set(['buly.kr', 'tinyurl.com', 'han.gl', 'vo.la', 'naver.me', 'bit.ly', 'alie.kr', 't.co',
  'url.kr', 'me2.do', 'goo.gl', 'lrl.kr', 'abit.ly', 'vvd.bz', 'buff.ly', 'ow.ly', 'is.gd', 'rb.gy', 'cutt.ly', 'shorturl.at',
  'news.google.com', 'lnkd.in', 'flip.it', 'apple.news', 'msn.com', 'feedproxy.google.com', 'da.gd', 'zrr.kr', 'muz.so', 'c11.kr', 'wo.to']);
export const IRRELEVANT = [/^amazon\./, /\.amazon\./, /coupang\.com$/, /youtube\.com$/, /^youtu\.be$/, /instagram\.com$/, /facebook\.com$/,
  /^x\.com$/, /twitter\.com$/, /apps\.apple\.com$/, /play\.google\.com$/, /aliexpress\.com$/];
export const REPORT_HOSTS = new Set(['report.jayjoai.com', 'r.jayjoai.com', 'bbn.kiwoom.com', 'iprovest.com', 'securities.miraeasset.com',
  'hanwhawm.com', 'research.ibk.co.kr', 'myasset.com', 'm.ibks.com', 'yuantakorea.com', 'kiwoom.com', 'm.nhsec.com']);
export const OFFICIAL_PATTERNS = [/^dart\.fss\.or\.kr$/, /^kind\.krx\.co\.kr$/, /(^|\.)sec\.gov$/, /\.go\.kr$/, /(^|\.)fss\.or\.kr$/, /(^|\.)krx\.co\.kr$/];

export const bareHost = host => host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
export const isRedirectHost = host => REDIRECT_HOSTS.has(bareHost(host));
export const isIrrelevantHost = host => IRRELEVANT.some(pattern => pattern.test(bareHost(host)));

// Pipeline routing for a URL under the signal-only news policy.
export function routeLink(url, config) {
  const host = new URL(url).hostname;
  if (isRedirectHost(host)) return 'REDIRECT';
  if (isIrrelevantHost(host)) return 'IRRELEVANT';
  const registered = (config.sources ?? []).find(source => source.host === host);
  if (registered && ['OFFICIAL', 'REPORT'].includes(registered.kind)) return 'EVIDENCE';
  return 'SIGNAL';
}
