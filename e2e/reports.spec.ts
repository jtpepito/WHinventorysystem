import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { login, splitCsvLine } from './helpers';

for (const key of ['stock-value', 'fast-movers', 'dead-stock', 'low-stock']) {
  test(`${key} CSV downloads and parses cleanly`, async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/reports');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`csv-${key}`).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${key}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const bytes = fs.readFileSync((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString('utf8');
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = text.replace(/\r\n$/, '').split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    const width = splitCsvLine(lines[0]).length;
    for (const line of lines) expect(splitCsvLine(line)).toHaveLength(width);
  });
}
