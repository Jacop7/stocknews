// Korea-time formatting shared by cards and detail screens.
export function formatKstDateTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatKstDate(iso: string): string {
  return formatKstDateTime(iso).slice(0, 10);
}
