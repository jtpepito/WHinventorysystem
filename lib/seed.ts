import type { DatabaseSync } from 'node:sqlite';
import { getCountSession, postCountSession, saveCountActuals, startCountSession } from './count';
import { createCustomer } from './customers';
import { postExpense } from './expenses';
import { ACC, postManualJournal } from './ledger';
import { VAT_RATE } from './money';
import { round } from './num';
import { postPurchase, postSupplierPayment } from './purchases';
import { postCustomerPayment } from './receivables';
import { postSale } from './sales';
import { setSetting } from './settings';
import { tx } from './sqlite';
import { addDays, manilaAt, manilaDay, nowIso } from './time';

type SeedItem = { sku: string; name: string; unit: string; cost: number };

const CATALOG: Record<string, { supplier: number; items: SeedItem[] }> = {
  Electrical: { supplier: 0, items: [
    { sku: 'EL-001', name: 'THHN Wire 2.0mm² (150m)', unit: 'roll', cost: 2450 },
    { sku: 'EL-002', name: 'THHN Wire 3.5mm² (150m)', unit: 'roll', cost: 3980 },
    { sku: 'EL-003', name: 'Convenience Outlet, Duplex', unit: 'pc', cost: 85 },
    { sku: 'EL-004', name: 'Wall Switch, 1-Gang', unit: 'pc', cost: 65 },
    { sku: 'EL-005', name: 'LED Bulb 9W Daylight', unit: 'pc', cost: 95 },
    { sku: 'EL-006', name: 'Circuit Breaker 20A Plug-in', unit: 'pc', cost: 320 },
    { sku: 'EL-007', name: 'PVC Electrical Tape 19mm', unit: 'roll', cost: 28 },
    { sku: 'EL-008', name: 'Utility Box 2x4', unit: 'pc', cost: 22 },
  ] },
  Plumbing: { supplier: 1, items: [
    { sku: 'PL-001', name: 'PPR Pipe 20mm x 4m', unit: 'pc', cost: 210 },
    { sku: 'PL-002', name: 'PVC Pipe 2in x 3m (Orange)', unit: 'pc', cost: 245 },
    { sku: 'PL-003', name: 'PVC Elbow 1/2in', unit: 'pc', cost: 12 },
    { sku: 'PL-004', name: 'Gate Valve 1/2in Brass', unit: 'pc', cost: 285 },
    { sku: 'PL-005', name: 'Teflon Tape 1/2in', unit: 'roll', cost: 15 },
    { sku: 'PL-006', name: 'Lavatory Faucet, Stainless', unit: 'pc', cost: 450 },
    { sku: 'PL-007', name: 'Flexible Hose 1/2 x 1/2 x 16in', unit: 'pc', cost: 120 },
    { sku: 'PL-008', name: 'PVC Solvent Cement 100cc', unit: 'pc', cost: 75 },
  ] },
  Tools: { supplier: 0, items: [
    { sku: 'TL-001', name: 'Claw Hammer 16oz', unit: 'pc', cost: 260 },
    { sku: 'TL-002', name: 'Screwdriver Set, 6pc', unit: 'set', cost: 340 },
    { sku: 'TL-003', name: 'Measuring Tape 5m', unit: 'pc', cost: 150 },
    { sku: 'TL-004', name: 'Hacksaw Frame 12in', unit: 'pc', cost: 210 },
    { sku: 'TL-005', name: 'Combination Pliers 8in', unit: 'pc', cost: 185 },
    { sku: 'TL-006', name: 'Cutting Disc 4in (box of 25)', unit: 'box', cost: 380 },
    { sku: 'TL-007', name: 'Paint Brush 2in', unit: 'pc', cost: 45 },
    { sku: 'TL-008', name: 'Masonry Trowel 7in', unit: 'pc', cost: 130 },
  ] },
  Paint: { supplier: 2, items: [
    { sku: 'PT-001', name: 'Latex Paint, White', unit: 'gal', cost: 620 },
    { sku: 'PT-002', name: 'Enamel Paint, Black', unit: 'gal', cost: 720 },
    { sku: 'PT-003', name: 'Red Oxide Primer', unit: 'gal', cost: 540 },
    { sku: 'PT-004', name: 'Paint Thinner', unit: 'L', cost: 110 },
    { sku: 'PT-005', name: 'Wood Varnish, Clear', unit: 'L', cost: 260 },
    { sku: 'PT-006', name: 'Masonry Putty', unit: 'kg', cost: 95 },
    { sku: 'PT-007', name: 'Acrylic Emulsion, Blue', unit: 'gal', cost: 650 },
    { sku: 'PT-008', name: 'Paint Roller Set 7in', unit: 'set', cost: 155 },
  ] },
  Fasteners: { supplier: 1, items: [
    { sku: 'FS-001', name: 'Common Nail 2in', unit: 'kg', cost: 85 },
    { sku: 'FS-002', name: 'Common Nail 4in', unit: 'kg', cost: 82 },
    { sku: 'FS-003', name: 'Concrete Nail 2in', unit: 'kg', cost: 120 },
    { sku: 'FS-004', name: 'Wood Screw #8 x 1in (box)', unit: 'box', cost: 140 },
    { sku: 'FS-005', name: 'Tek Screw 1in (box)', unit: 'box', cost: 260 },
    { sku: 'FS-006', name: 'Hex Bolt with Nut 1/2 x 3in', unit: 'pc', cost: 18 },
    { sku: 'FS-007', name: 'Plastic Wall Plug 1/4in (box)', unit: 'box', cost: 65 },
    { sku: 'FS-008', name: 'Blind Rivet 1/8in (box)', unit: 'box', cost: 95 },
  ] },
};

const SUPPLIERS = [
  { name: 'Metro Electrical & Tools Supply', contact: '(02) 8123 4567' },
  { name: 'Luzon Pipe & Fasteners Co.', contact: '0917 555 0142' },
  { name: 'Bulacan Paint Distributors', contact: '0918 555 0199' },
];
// Named (on-account) customers; walk-in sales carry no customer.
const CUSTOMERS = ['JDC Construction', 'Santos Residence Project', 'Reyes Builders', 'Dela Cruz Electrical Services'];
const MARKUP = 1.35;

export const LOW_STOCK_SKUS = ['EL-005', 'PL-003', 'TL-006', 'PT-001', 'FS-001', 'FS-004'];
export const DEAD_STOCK_SKUS = ['EL-008', 'TL-008', 'PT-005'];
const COUNT_VARIANCES: Record<string, number> = { 'FS-002': -3, 'FS-006': -1, 'FS-007': 2 };

function mulberry32(seedValue: number) {
  let a = seedValue;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(db: DatabaseSync, now = nowIso()): void {
  const rand = mulberry32(20261002);
  const rint = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const today = manilaDay(now);
  const at = (daysAgo: number, hour: number, minute = 0) => manilaAt(addDays(today, -daysAgo), hour, minute);

  tx(db, () => {
    const id = (sql: string, ...p: (string | number)[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
    const day = (daysAgo: number) => manilaDay(at(daysAgo, 12));
    setSetting(db, 'business_name', 'Sample Hardware Trading');
    setSetting(db, 'business_address', '123 Rizal St., San Isidro');
    setSetting(db, 'receipt_footer', 'Thank you! Goods are checked before leaving the store.');
    const supplierIds = SUPPLIERS.map((s) => id('INSERT INTO suppliers (name, contact) VALUES (?, ?)', s.name, s.contact));
    const customerIds = CUSTOMERS.map((name) => createCustomer(db, { name, termsDays: 30 }));
    const unitIds = new Map<string, number>();
    const items: { id: number; sku: string; cost: number; price: number; supplier: number; categoryId: number }[] = [];
    for (const [category, group] of Object.entries(CATALOG)) {
      const categoryId = id('INSERT INTO categories (name) VALUES (?)', category);
      for (const it of group.items) {
        if (!unitIds.has(it.unit)) unitIds.set(it.unit, id('INSERT INTO units (name) VALUES (?)', it.unit));
        const price = round(it.cost * MARKUP, 2);
        const itemId = id('INSERT INTO items (sku, name, category_id, unit_id, sell_price) VALUES (?, ?, ?, ?, ?)', it.sku, it.name, categoryId, unitIds.get(it.unit)!, price);
        items.push({ id: itemId, sku: it.sku, cost: it.cost, price, supplier: group.supplier, categoryId });
      }
    }
    const qty = (itemId: number) => (db.prepare('SELECT qty FROM items WHERE id = ?').get(itemId) as { qty: number }).qty;
    const isLow = (sku: string) => LOW_STOCK_SKUS.includes(sku);
    const isDead = (sku: string) => DEAD_STOCK_SKUS.includes(sku);
    let seq = 1000;

    // Day 62: the owner puts in capital, then the opening stock arrives on account and is paid ten days later.
    postManualJournal(db, { date: day(62), memo: 'Owner capital', lines: [{ account: ACC.bank, debit: 150000 }, { account: ACC.cash, debit: 50000 }, { account: ACC.capital, credit: 200000 }] }, 'admin', at(62, 8));
    const opening = supplierIds.map((supplierId, s) => {
      const lines = items.filter((i) => i.supplier === s).map((i) => ({ itemId: i.id, qty: rint(40, 150), unitCost: i.cost }));
      return postPurchase(db, { date: day(62), supplierId, refNo: `OB-${s + 1}`, method: 'credit', vatInvoice: false, note: 'Opening stock', lines }, 'admin', at(62, 9 + s));
    });
    opening.forEach((p) => postSupplierPayment(db, { date: day(52), purchaseId: p.id, amount: p.total, method: 'bank', refNo: `CHK-${++seq}` }, 'admin', at(52, 10)));

    const monthly = (d: number) => {
      postExpense(db, { date: day(d), accountCode: '6100', payee: 'A. Villanueva (lessor)', amount: 15000, vatInvoice: true, method: 'bank', refNo: `OR-${++seq}` }, 'admin', at(d, 9));
      postExpense(db, { date: day(d), accountCode: '6300', payee: 'Meralco', amount: 3584, vatInvoice: true, method: 'gcash', refNo: `${++seq}` }, 'admin', at(d, 9, 30));
      postExpense(db, { date: day(d), accountCode: '6200', payee: 'Staff payroll', amount: 18000, vatInvoice: false, method: 'cash' }, 'admin', at(d, 17));
    };
    monthly(60);
    monthly(30);
    postExpense(db, { date: day(45), accountCode: '6500', payee: 'National Bookstore', amount: 1120, vatInvoice: true, method: 'cash', refNo: `${++seq}` }, 'encoder', at(45, 11));

    const movers = items.filter((i) => !isDead(i.sku));
    const fasteners = items.find((i) => i.sku === 'FS-001')!.categoryId;
    for (let d = 58; d >= 1; d--) {
      const salesToday = rint(2, 5);
      for (let k = 0; k < salesToday; k++) {
        const lines: { itemId: number; qty: number; unitPrice: number }[] = [];
        for (let n = rint(1, 3); n > 0; n--) {
          const it = movers[rint(0, movers.length - 1)];
          if (lines.some((l) => l.itemId === it.id)) continue;
          const room = Math.floor(qty(it.id) - (isLow(it.sku) ? 2 : 12));
          if (room < 1) continue;
          lines.push({ itemId: it.id, qty: rint(1, Math.min(room, 15)), unitPrice: it.price });
        }
        if (!lines.length) continue;
        const roll = rand();
        const method = roll < 0.7 ? 'cash' : roll < 0.85 ? 'gcash' : 'credit';
        const customerId = method === 'credit' || rand() < 0.2 ? customerIds[rint(0, customerIds.length - 1)] : null;
        const sale = postSale(db, { date: day(d), customerId, method, lines }, 'encoder', at(d, 9 + k, rint(0, 59)));
        // About half the on-account sales get collected, in full or in part, a week or two later.
        const collectOn = d - rint(5, 20);
        if (method === 'credit' && collectOn >= 1 && rand() < 0.55) {
          const amount = rand() < 0.6 ? sale.total : round(sale.total * 0.5, 2);
          postCustomerPayment(db, { date: day(collectOn), saleId: sale.id, amount, method: rand() < 0.5 ? 'cash' : 'bank', refNo: `OR-${++seq}` }, 'encoder', at(collectOn, 10, rint(0, 59)));
        }
      }
      if (d % 7 === 0) {
        supplierIds.forEach((supplierId, s) => {
          const lines = items
            .filter((i) => i.supplier === s && !isDead(i.sku) && !isLow(i.sku) && qty(i.id) < 40)
            .map((i) => ({ itemId: i.id, qty: rint(30, 80), unitCost: round(i.cost * (0.95 + rand() * 0.15) * (1 + VAT_RATE), 2) }));
          if (!lines.length) return;
          const method = s === 0 ? 'credit' : 'bank';
          const p = postPurchase(db, { date: day(d), supplierId, refNo: `INV-${++seq}`, method, vatInvoice: true, lines }, 'admin', at(d, 15));
          if (method === 'credit' && d - 7 >= 1) postSupplierPayment(db, { date: day(d - 7), purchaseId: p.id, amount: p.total, method: 'bank', refNo: `CHK-${++seq}` }, 'admin', at(d - 7, 11));
        });
      }
      if (d === 10) {
        const sid = startCountSession(db, { categoryId: fasteners }, at(d, 16));
        const session = getCountSession(db, sid)!;
        saveCountActuals(db, sid, session.lines.map((l) => ({ lineId: l.lineId, actual: Math.max(0, l.expected + (COUNT_VARIANCES[l.sku] ?? 0)) })));
        postCountSession(db, sid, 'admin', at(d, 17));
      }
    }

    // Reorder points: the 6 low items sit at or below theirs; everything else sits comfortably above.
    for (const it of items) {
      const q = qty(it.id);
      const rp = isLow(it.sku) ? Math.ceil(q) + 5 : Math.max(1, Math.floor(q / 4));
      db.prepare('UPDATE items SET reorder_point = ? WHERE id = ?').run(rp, it.id);
    }
  });
}

// Categories and units only — what a real shop needs before adding its first item.
export function seedStarter(db: DatabaseSync): void {
  tx(db, () => {
    for (const name of Object.keys(CATALOG)) db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    const units = [...new Set(Object.values(CATALOG).flatMap((g) => g.items.map((i) => i.unit))), 'm'];
    for (const name of units) db.prepare('INSERT INTO units (name) VALUES (?)').run(name);
  });
}

// "Empty" means never set up: both seeds create categories, and a real shop keeps at least one.
export function seedIfEmpty(db: DatabaseSync, now = nowIso(), opts: { sample: boolean } = { sample: true }): boolean {
  const { n } = db.prepare('SELECT (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM items) AS n').get() as { n: number };
  if (n > 0) return false;
  if (opts.sample) seed(db, now);
  else seedStarter(db);
  return true;
}
