import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

describe('node:sqlite', () => {
  it('opens an in-memory database', () => {
    const db = new DatabaseSync(':memory:');
    expect({ ...(db.prepare('SELECT 1 + 1 AS two').get() as object) }).toEqual({ two: 2 });
  });
});
