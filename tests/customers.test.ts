import { describe, expect, it } from 'vitest';
import { createCustomer, getCustomer, listCustomers, updateCustomer, WALK_IN } from '@/lib/customers';
import { makeDb } from './helpers';

describe('customers', () => {
  it('creates with defaults and reads back', () => {
    const { db } = makeDb();
    const id = createCustomer(db, { name: '  JDC Construction ', contact: '0917 000 1111', termsDays: 15 });
    expect(getCustomer(db, id)).toEqual({ id, name: 'JDC Construction', contact: '0917 000 1111', termsDays: 15, active: true });
    expect(createCustomer(db, { name: 'Reyes Builders' })).toBeGreaterThan(id);
    expect(getCustomer(db, id + 1)?.termsDays).toBe(30);
    expect(WALK_IN).toBe('Walk-in');
  });
  it('validates name, uniqueness and terms', () => {
    const { db } = makeDb();
    createCustomer(db, { name: 'JDC Construction' });
    expect(() => createCustomer(db, { name: ' ' })).toThrow('Customer name is required.');
    expect(() => createCustomer(db, { name: 'jdc construction' })).toThrow('Customer "jdc construction" already exists.');
    expect(() => createCustomer(db, { name: 'X', termsDays: -1 })).toThrow(/Credit terms/);
    expect(() => createCustomer(db, { name: 'X', termsDays: 400 })).toThrow(/Credit terms/);
  });
  it('updates, deactivates, lists with search', () => {
    const { db } = makeDb();
    const a = createCustomer(db, { name: 'JDC Construction' });
    createCustomer(db, { name: 'Reyes Builders' });
    updateCustomer(db, a, { name: 'JDC Construction Inc', contact: 'x', termsDays: 45, active: false });
    expect(getCustomer(db, a)).toMatchObject({ name: 'JDC Construction Inc', termsDays: 45, active: false });
    expect(listCustomers(db).map((c) => c.name)).toEqual(['JDC Construction Inc', 'Reyes Builders']);
    expect(listCustomers(db, { activeOnly: true }).map((c) => c.name)).toEqual(['Reyes Builders']);
    expect(listCustomers(db, { q: 'rey' }).map((c) => c.name)).toEqual(['Reyes Builders']);
    expect(() => updateCustomer(db, 999, { name: 'x', contact: '', termsDays: 1, active: true })).toThrow(/Customer not found/);
  });
});
