/** Converts a previously obtained SEC Submissions document to filing metadata. */
export const secDocumentLimit = 4 * 1024 * 1024;
const forms = /^(?:8-K|10-K|10-Q|6-K|20-F|40-F)(?:\/A)?$/;
const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const acceptanceTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

type Filing = {
  accession: string;
  form: string;
  filedOn: string;
  acceptedAt: string;
  amendment: boolean;
  url: string;
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEC_SUBMISSIONS_SHAPE');
  }
  return value as Record<string, unknown>;
}

function column(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('SEC_SUBMISSIONS_COLUMNS');
  return value;
}

export function parseSecSubmissions(text: string, expectedCik: string) {
  if (!/^\d{10}$/.test(expectedCik) || Number(expectedCik) === 0) throw new Error('SEC_SUBMISSIONS_CIK');
  if (new TextEncoder().encode(text).byteLength > secDocumentLimit) throw new Error('SEC_SUBMISSIONS_SIZE');
  const document = record(JSON.parse(text));
  const cik = typeof document.cik === 'number' || typeof document.cik === 'string' ? String(document.cik) : '';
  if (!/^\d{1,10}$/.test(cik) || cik.padStart(10, '0') !== expectedCik) {
    throw new Error('SEC_SUBMISSIONS_WRONG_COMPANY');
  }

  const recent = record(record(document.filings).recent);
  const accessionColumn = column(recent.accessionNumber);
  const formColumn = column(recent.form);
  const dateColumn = column(recent.filingDate);
  const timeColumn = column(recent.acceptanceDateTime);
  if ([formColumn, dateColumn, timeColumn].some(values => values.length !== accessionColumn.length)) {
    throw new Error('SEC_SUBMISSIONS_COLUMNS');
  }

  const formByAccession = new Map<string, string>();
  const filings = new Map<string, Filing>();
  for (const [index, form] of formColumn.entries()) {
    if (typeof form !== 'string') throw new Error('SEC_SUBMISSIONS_FORM');
    const accession = accessionColumn[index];
    if (typeof accession !== 'string' || !accessionPattern.test(accession)) {
      throw new Error('SEC_SUBMISSIONS_ROW');
    }
    const previousForm = formByAccession.get(accession);
    if (previousForm !== undefined && previousForm !== form) {
      throw new Error('SEC_SUBMISSIONS_CONFLICTING_ACCESSION');
    }
    formByAccession.set(accession, form);
    if (!forms.test(form)) continue;

    const filedOn = dateColumn[index];
    const rawTime = timeColumn[index];
    if (typeof filedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(filedOn) ||
        typeof rawTime !== 'string' || !acceptanceTime.test(rawTime)) {
      throw new Error('SEC_SUBMISSIONS_ROW');
    }
    const date = new Date(filedOn + 'T00:00:00Z');
    const accepted = new Date(rawTime);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== filedOn ||
        !Number.isFinite(accepted.getTime()) || accepted.toISOString().slice(0, 19) !== rawTime.slice(0, 19)) {
      throw new Error('SEC_SUBMISSIONS_ROW_TIME');
    }

    const acceptedAt = accepted.toISOString();
    const existing = filings.get(accession);
    if (existing) {
      if (existing.filedOn !== filedOn || existing.acceptedAt !== acceptedAt) {
        throw new Error('SEC_SUBMISSIONS_CONFLICTING_ACCESSION');
      }
      continue;
    }
    const url = 'https://www.sec.gov/Archives/edgar/data/' + Number(expectedCik) + '/' +
      accession.replaceAll('-', '') + '/' + accession + '-index.html';
    filings.set(accession, {accession, form, filedOn, acceptedAt, amendment: form.endsWith('/A'), url});
  }
  return [...filings.values()].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt) ||
    b.accession.localeCompare(a.accession));
}
