// Company IDs read on one OCR'd screenshot, sorted and joined (capture.ps1 uses it to detect the end of a list and a
// failed tab switch). Prints nothing else; no prices.
import { readFileSync } from 'node:fs';
import { parseWatchlist, indexMaster } from './parse.mjs';

const master = JSON.parse(readFileSync(new URL('../../../data/stock-master.json', import.meta.url), 'utf8'));
const ocr = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
const r = parseWatchlist(ocr, indexMaster(master));
console.log(r.ok ? r.rows.map(x => x.companyId).sort().join(',') : 'HEADER_NOT_FOUND');
