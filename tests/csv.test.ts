import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('toCsv', () => {
  it('starts with a BOM and uses CRLF', () => {
    const out = toCsv(['A', 'B'], [[1, 'x']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('A,B\r\n1,x\r\n');
  });
  it('quotes commas, quotes and newlines', () => {
    const out = toCsv(['Name'], [['Pipe 1/2", blue'], ['two\nlines']]);
    expect(out.slice(1)).toBe('Name\r\n"Pipe 1/2"", blue"\r\n"two\nlines"\r\n');
  });
  it('neutralises formula-looking text but not numbers', () => {
    const out = toCsv(['T', 'N'], [['=SUM(A1)', -3], ['@cmd', 0], ['+63 917', null]]);
    expect(out.slice(1)).toBe("T,N\r\n'=SUM(A1),-3\r\n'@cmd,0\r\n'+63 917,\r\n");
  });
  it('keeps ₱ and other unicode as-is', () => {
    expect(toCsv(['V'], [['₱75.00']]).slice(1)).toBe('V\r\n₱75.00\r\n');
  });
});
