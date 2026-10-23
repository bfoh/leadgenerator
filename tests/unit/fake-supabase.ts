// A small in-memory stand-in for the Supabase query builder, enough for the server's messaging code
// (dispatch and webhooks) to run in unit tests: select/insert/upsert/update/delete with eq, not-null,
// order, limit and range filters, unique keys and an rpc table. It does not run the database's
// triggers or policies; those are covered by the PGlite suites in tests/db.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null; count?: number | null };

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, unknown> = {};
  /** Unique keys per table, checked on insert and used by upsert's onConflict. */
  unique: Record<string, string[][]> = {};
  /** Column defaults applied on insert. */
  defaults: Record<string, Row> = {};
  writes: { table: string; op: string; values: unknown }[] = [];

  rows(table: string) {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new Query(this, table);
  }

  rpc(name: string) {
    return Promise.resolve(name in this.rpcs ? { data: this.rpcs[name], error: null } : { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } });
  }

  get client() {
    return this as unknown as SupabaseClient;
  }
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private values: Row[] = [];
  private patch: Row = {};
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private head = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns?: string, opts?: { head?: boolean }) {
    if (opts?.head) this.head = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = 'insert';
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.values = Array.isArray(values) ? values : [values];
    this.onConflict = opts.onConflict?.split(',').map((c) => c.trim()) ?? null;
    this.ignoreDuplicates = Boolean(opts.ignoreDuplicates);
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.patch = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) throw new Error(`FakeSupabase: not(${operator}) is not supported`);
    this.filters.push((r) => r[column] !== null && r[column] !== undefined);
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.window = [0, n - 1];
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }

  private conflict(row: Row, keys: string[][]) {
    return this.db.rows(this.table).find((r) => keys.some((key) => key.every((c) => r[c] !== undefined && r[c] !== null && r[c] === row[c])));
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    let out: Row[];
    if (this.op === 'insert' || this.op === 'upsert') {
      out = [];
      for (const v of this.values) {
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...this.db.defaults[this.table], ...v };
        const keys = this.op === 'upsert' && this.onConflict ? [this.onConflict] : (this.db.unique[this.table] ?? []);
        if (this.conflict(row, keys)) {
          if (this.op === 'upsert' && this.ignoreDuplicates) continue;
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.table}` } };
        }
        rows.push(row);
        out.push(structuredClone(row));
      }
      this.db.writes.push({ table: this.table, op: this.op, values: this.values });
    } else {
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        for (const r of matched) Object.assign(r, this.patch, { updated_at: new Date().toISOString() });
        this.db.writes.push({ table: this.table, op: 'update', values: this.patch });
      } else if (this.op === 'delete') {
        this.db.tables[this.table] = rows.filter((r) => !matched.includes(r));
      }
      out = matched.map((r) => structuredClone(r));
      for (const { column, ascending } of [...this.orders].reverse()) {
        out.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
      }
      if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    }
    if (this.head) return { data: null, error: null, count: out.length };
    if (this.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'Expected one row' } };
    if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null, count: out.length };
  }
}
