// Naver watchlist OCR → per-company change (docs/sector-news-plan.md §3.3). Pure functions, no I/O.
// Input: the JSON that ocr.ps1 prints ({ width, height, words: [{ text, x, y, w, h, color }] }).
// Identity comes only from the verified stock master (data/stock-master.json): a six-digit code in the master, or —
// when the code was not read — an exact, unique master name. The change % is recomputed from price and change amount
// and must agree with the OCR'd % within 0.2 points; the sign comes from the ink colour (red up, blue down, grey flat).
// Anything doubtful is dropped: a missed row is acceptable, a wrong row is not.
const digitsOnly = text => String(text).replace(/[^0-9]/g, '');
const squeeze = text => String(text).normalize('NFC').replace(/\s+/g, '');

export function signOf(color) {
  if (!Array.isArray(color)) return null;
  const [r, g, b] = color;
  if (r >= 150 && r - b >= 60 && r - g >= 60) return 1;
  if (b >= 150 && b - r >= 60) return -1;
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 25) return 0;
  return null;
}

// Header line: 종목명 (OCR often reads 좋목명), 현재가, 전일대비 and 거래량, all on one line.
export function columns(words) {
  const price = words.find(w => squeeze(w.text) === '현재가');
  if (!price) return null;
  const line = words.filter(w => Math.abs(w.y - price.y) <= 8);
  const name = line.find(w => /목명$/.test(squeeze(w.text)) && w.x < price.x);
  const change = line.find(w => squeeze(w.text).startsWith('전일대') && w.x > price.x);
  const volume = line.filter(w => squeeze(w.text).startsWith('거래') && w.x > (change?.x ?? Infinity)).sort((a, b) => a.x - b.x)[0];
  if (!name || !change || !volume) return null;
  return { headerY: price.y, nameMax: price.x - 150, priceMin: price.x - 150, priceMax: price.x + 60, changeMin: price.x + 60, changeMax: volume.x - 60 };
}

export function indexMaster(master) {
  const byCode = new Map(), byName = new Map(), names = new Map();
  for (const c of master.companies) { byCode.set(c.stockCode, c); names.set(squeeze(c.name), (names.get(squeeze(c.name)) ?? 0) + 1); }
  for (const c of master.companies) if (names.get(squeeze(c.name)) === 1) byName.set(squeeze(c.name), c);
  return { byCode, byName, size: master.companies.length };
}

export function parseWatchlist(ocr, index) {
  const words = (ocr?.words ?? []).filter(w => typeof w?.text === 'string' && Number.isFinite(w.x) && Number.isFinite(w.y));
  const col = columns(words);
  if (!col) return { rows: [], dropped: [{ reason: 'HEADER_NOT_FOUND' }], ok: false };
  const body = words.filter(w => w.y > col.headerY + 10);
  const codeAnchors = body.filter(w => w.x < col.nameMax && /^[0-9OoIl|/]{6}$/.test(squeeze(w.text)));
  // A row whose code was not read: an exact master name with no code word just below it (the code line is ~19 px lower).
  const nameAnchors = body.filter(w => w.x < col.nameMax && index.byName.has(squeeze(w.text))
    && !codeAnchors.some(c => c.y > w.y && c.y - w.y <= 30)).map(w => ({ text: '', y: w.y + 19, x: w.x }));
  const anchors = [...codeAnchors, ...nameAnchors].sort((a, b) => a.y - b.y);
  const rows = [], dropped = [];
  for (const anchor of anchors) {
    const band = body.filter(w => w.y >= anchor.y - 30 && w.y <= anchor.y + 14);
    const nameText = squeeze(band.filter(w => w.x < col.nameMax && w !== anchor && w.y < anchor.y - 4).sort((a, b) => a.x - b.x).map(w => w.text).join(''));
    const rawCode = squeeze(anchor.text), code = /^\d{6}$/.test(rawCode) ? rawCode : null;
    const coded = code ? index.byCode.get(code) ?? null : null, named = index.byName.get(nameText) ?? null;
    if (code && !coded) { dropped.push({ reason: 'CODE_NOT_IN_MASTER', code, name: nameText.slice(0, 40) }); continue; }
    if (coded && nameText && named && named.companyId !== coded.companyId) { dropped.push({ reason: 'NAME_CODE_CONFLICT' }); continue; }
    const company = coded ?? named;
    if (!company) { dropped.push({ reason: 'UNIDENTIFIED', code: rawCode.slice(0, 6), name: nameText.slice(0, 40) }); continue; }
    const changeWords = band.filter(w => w.x >= col.changeMin && w.x < col.changeMax).sort((a, b) => a.x - b.x);
    const price = Number(digitsOnly(band.filter(w => w.x >= col.priceMin && w.x < col.priceMax).sort((a, b) => a.x - b.x).map(w => w.text).join('')));
    const changeText = changeWords.map(w => w.text).join('');
    const amount = Number(digitsOnly(changeText.split('(')[0]));
    const pctMatch = /\(\s*[+\-−]?\s*(\d{1,3})\.(\d{2})/.exec(changeText);
    const pctOcr = pctMatch ? Number(pctMatch[1] + '.' + pctMatch[2]) : null;
    const signs = changeWords.map(w => signOf(w.color)).filter(s => s !== null);
    const sign = signs.length && signs.every(s => s === signs[0]) ? signs[0] : null;
    if (!(price > 0) || !changeText || !/\d/.test(changeText.split('(')[0])) { dropped.push({ reason: 'NUMBER_UNREADABLE', companyId: company.companyId }); continue; }
    if (sign === null || (sign === 0) !== (amount === 0)) { dropped.push({ reason: 'SIGN_UNREADABLE', companyId: company.companyId }); continue; }
    const base = price - sign * amount;
    if (!(base > 0)) { dropped.push({ reason: 'NUMBER_INCONSISTENT', companyId: company.companyId }); continue; }
    const pct = Math.round(sign * amount / base * 10000) / 100;
    if (pctOcr === null) { dropped.push({ reason: 'PCT_UNREADABLE', companyId: company.companyId }); continue; }
    if (Math.abs(Math.abs(pct) - pctOcr) > 0.2) { dropped.push({ reason: 'PCT_MISMATCH', companyId: company.companyId }); continue; }
    rows.push({ companyId: company.companyId, price, change: sign * amount, pct });
  }
  return { rows, dropped, ok: true };
}

// Several screenshots of one round: the same company read twice must agree, or it is dropped.
export function mergeRound(parts) {
  const seen = new Map(), conflict = new Set();
  for (const row of parts.flatMap(p => p.rows)) {
    const prior = seen.get(row.companyId);
    if (prior && (prior.price !== row.price || prior.change !== row.change)) conflict.add(row.companyId);
    else if (!prior) seen.set(row.companyId, row);
  }
  return { rows: [...seen.values()].filter(r => !conflict.has(r.companyId)), conflicts: [...conflict] };
}
