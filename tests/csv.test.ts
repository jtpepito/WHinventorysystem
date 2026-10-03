import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('reads plain rows with CRLF or LF and drops a trailing blank line', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('strips a UTF-8 BOM (Excel "CSV UTF-8")', () => {
    expect(parseCsv('﻿SKU,Name\nA,B')).toEqual([['SKU', 'Name'], ['A', 'B']]);
  });
  it('handles quotes, doubled quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('"Pipe 1/2"", blue","two\nlines",x')).toEqual([['Pipe 1/2", blue', 'two\nlines', 'x']]);
  });
  it('keeps empty cells and skips fully blank lines', () => {
    expect(parseCsv('a,,c\n\n,,\nd,e,f')).toEqual([['a', '', 'c'], ['d', 'e', 'f']]);
  });
  it('round-trips what toCsv writes, removing its formula guard', () => {
    const out = toCsv(['T', 'N'], [['=SUM(A1)', 5], ['₱75, ok', null]]);
    expect(parseCsv(out)).toEqual([['T', 'N'], ['=SUM(A1)', '5'], ['₱75, ok', '']]);
  });
});

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
