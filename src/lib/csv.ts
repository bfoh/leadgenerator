// CSV export with spreadsheet formula-injection protection: cells beginning with = + - @ (or tab/CR)
// are prefixed with an apostrophe so spreadsheet apps treat them as text.

export function csvCell(value: unknown): string {
  let s = value == null ? '' : Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => unknown }[]): string {
  return [columns.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))].join('\r\n');
}
