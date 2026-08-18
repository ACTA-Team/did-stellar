/**
 * Postgres / Supabase {@link DidIndexStore}.
 *
 * Chosen when `DID_INDEX_DATABASE_URL` is set. Two properties matter:
 *
 *   1. **Durability** - the historical backfill runs once, not on every
 *      boot. Without it a restart re-walks the whole RPC retention window.
 *   2. **Sharing** - several API replicas answer from one index while a
 *      single worker writes to it.
 *
 * `pg` is imported dynamically so a memory-mode deployment never loads
 * the driver, mirroring how `ioredis` is treated in the API's cache.
 *
 * Event folding reuses the same pure reducer as the in-memory store: the
 * affected rows are read inside a transaction, reduced in JS, and written
 * back with a `last_event_id` guard. Keeping the reduction in one place
 * is worth the round-trip - a second implementation in SQL would be a
 * standing invitation for the two backends to disagree.
 */

import { reduceEvents, toIndexedDid } from '../reduce';

import { buildSchemaSql, DEFAULT_SCHEMA, TABLE_CURSORS, TABLE_DIDS } from './schema';

import type { DidRegistryEvent } from '../events';
import type { DidIndexState, IndexCursor, IndexedDid } from '../types';
import type { ApplyEventsResult, DidIndexStore } from './types';
import type { NetworkType } from '@acta-team/did-stellar';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface PostgresIndexStoreOptions {
  readonly connectionString: string;
  /** Schema to create the tables in. Defaults to `public`. */
  readonly schema?: string;
  /** Max pool connections. Defaults to 5 - the worker is not read-heavy. */
  readonly maxConnections?: number;
  /**
   * Skip `CREATE TABLE` on init. Set when the schema is applied through
   * migrations and the service role has no DDL grant.
   */
  readonly skipSchema?: boolean;
  /** Require TLS without certificate verification (Supabase poolers). */
  readonly ssl?: boolean;
}

interface DidRow extends QueryResultRow {
  did_id: string;
  controller: string | null;
  version: number;
  deactivated: boolean;
  created_ledger: number;
  updated_ledger: number;
  last_event_id: string;
  last_event_ledger: number;
}

interface CursorRow extends QueryResultRow {
  cursor: string | null;
  first_ledger: number;
  last_ledger: number;
  synced_at: Date;
}

export class PostgresIndexStore implements DidIndexStore {
  readonly kind = 'postgres' as const;

  private readonly schema: string;
  private pool: Pool | null = null;
  private initialised = false;

  constructor(private readonly options: PostgresIndexStoreOptions) {
    this.schema = options.schema ?? DEFAULT_SCHEMA;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    const pool = await this.getPool();
    if (this.options.skipSchema !== true) {
      await pool.query(buildSchemaSql(this.schema));
    }
    this.initialised = true;
  }

  async applyEvents(
    network: NetworkType,
    events: readonly DidRegistryEvent[]
  ): Promise<ApplyEventsResult> {
    if (events.length === 0) return { seen: 0, written: 0 };
    const didIds = [...new Set(events.map((e) => e.didId))];

    return this.withTransaction(async (client) => {
      // `FOR UPDATE` serialises concurrent writers on exactly the rows
      // this batch touches; a second indexer replica blocks rather than
      // clobbering a newer projection.
      const existing = await client.query<DidRow>(
        `SELECT did_id, controller, version, deactivated, created_ledger,
                updated_ledger, last_event_id, last_event_ledger
           FROM ${this.dids()}
          WHERE network = $1 AND did_id = ANY($2::text[])
          FOR UPDATE`,
        [network, didIds]
      );

      const current = new Map<string, DidIndexState>();
      for (const row of existing.rows) current.set(row.did_id, toState(row));

      const changed = reduceEvents(current, events);
      for (const state of changed.values()) {
        await client.query(
          `INSERT INTO ${this.dids()}
             (network, did_id, controller, version, deactivated,
              created_ledger, updated_ledger, last_event_id, last_event_ledger, indexed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (network, did_id) DO UPDATE SET
             controller        = EXCLUDED.controller,
             version           = EXCLUDED.version,
             deactivated       = EXCLUDED.deactivated,
             created_ledger    = GREATEST(${this.dids()}.created_ledger, EXCLUDED.created_ledger),
             updated_ledger    = EXCLUDED.updated_ledger,
             last_event_id     = EXCLUDED.last_event_id,
             last_event_ledger = EXCLUDED.last_event_ledger,
             indexed_at        = now()
           WHERE EXCLUDED.last_event_id > ${this.dids()}.last_event_id`,
          [
            network,
            state.didId,
            state.controller,
            state.version,
            state.deactivated,
            state.createdLedger,
            state.updatedLedger,
            state.lastEventId,
            state.lastEventLedger,
          ]
        );
      }

      return { seen: events.length, written: changed.size };
    });
  }

  async putStates(network: NetworkType, states: readonly DidIndexState[]): Promise<void> {
    if (states.length === 0) return;
    await this.withTransaction(async (client) => {
      for (const state of states) {
        // Reconciliation carries authoritative ledger state, so it wins
        // unconditionally - no `last_event_id` guard here.
        await client.query(
          `INSERT INTO ${this.dids()}
             (network, did_id, controller, version, deactivated,
              created_ledger, updated_ledger, last_event_id, last_event_ledger, indexed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (network, did_id) DO UPDATE SET
             controller        = EXCLUDED.controller,
             version           = EXCLUDED.version,
             deactivated       = EXCLUDED.deactivated,
             created_ledger    = EXCLUDED.created_ledger,
             updated_ledger    = EXCLUDED.updated_ledger,
             last_event_id     = GREATEST(${this.dids()}.last_event_id, EXCLUDED.last_event_id),
             last_event_ledger = GREATEST(${this.dids()}.last_event_ledger, EXCLUDED.last_event_ledger),
             indexed_at        = now()`,
          [
            network,
            state.didId,
            state.controller,
            state.version,
            state.deactivated,
            state.createdLedger,
            state.updatedLedger,
            state.lastEventId,
            state.lastEventLedger,
          ]
        );
      }
    });
  }

  async removeDids(network: NetworkType, didIds: readonly string[]): Promise<void> {
    if (didIds.length === 0) return;
    const pool = await this.getPool();
    await pool.query(`DELETE FROM ${this.dids()} WHERE network = $1 AND did_id = ANY($2::text[])`, [
      network,
      [...didIds],
    ]);
  }

  async getStates(
    network: NetworkType,
    didIds: readonly string[]
  ): Promise<Map<string, DidIndexState>> {
    if (didIds.length === 0) return new Map();
    const pool = await this.getPool();
    const res = await pool.query<DidRow>(
      `SELECT did_id, controller, version, deactivated, created_ledger,
              updated_ledger, last_event_id, last_event_ledger
         FROM ${this.dids()}
        WHERE network = $1 AND did_id = ANY($2::text[])`,
      [network, [...didIds]]
    );
    const out = new Map<string, DidIndexState>();
    for (const row of res.rows) out.set(row.did_id, toState(row));
    return out;
  }

  async listByController(network: NetworkType, controller: string): Promise<IndexedDid[]> {
    const pool = await this.getPool();
    const res = await pool.query<DidRow>(
      `SELECT did_id, controller, version, deactivated, created_ledger,
              updated_ledger, last_event_id, last_event_ledger
         FROM ${this.dids()}
        WHERE network = $1 AND controller = $2
        ORDER BY created_ledger ASC, did_id ASC`,
      [network, controller]
    );
    const rows: IndexedDid[] = [];
    for (const row of res.rows) {
      const projected = toIndexedDid(network, toState(row));
      if (projected) rows.push(projected);
    }
    return rows;
  }

  async listDidIds(
    network: NetworkType,
    opts: { readonly limit: number; readonly after?: string; readonly onlyUnresolved?: boolean }
  ): Promise<string[]> {
    const pool = await this.getPool();
    const res = await pool.query<{ did_id: string }>(
      `SELECT did_id
         FROM ${this.dids()}
        WHERE network = $1
          AND ($2::text IS NULL OR did_id > $2::text)
          AND ($3::boolean IS NOT TRUE OR controller IS NULL)
        ORDER BY did_id ASC
        LIMIT $4`,
      [network, opts.after ?? null, opts.onlyUnresolved ?? false, Math.max(0, opts.limit)]
    );
    return res.rows.map((r) => r.did_id);
  }

  async countDids(network: NetworkType): Promise<number> {
    const pool = await this.getPool();
    const res = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${this.dids()} WHERE network = $1`,
      [network]
    );
    return Number.parseInt(res.rows[0]?.count ?? '0', 10);
  }

  async getCursor(network: NetworkType): Promise<IndexCursor | null> {
    const pool = await this.getPool();
    const res = await pool.query<CursorRow>(
      `SELECT cursor, first_ledger, last_ledger, synced_at
         FROM ${this.cursors()} WHERE network = $1`,
      [network]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      network,
      cursor: row.cursor,
      firstLedger: row.first_ledger,
      lastLedger: row.last_ledger,
      syncedAt: row.synced_at.toISOString(),
    };
  }

  async setCursor(cursor: IndexCursor): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO ${this.cursors()} (network, cursor, first_ledger, last_ledger, synced_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (network) DO UPDATE SET
         cursor       = EXCLUDED.cursor,
         first_ledger = EXCLUDED.first_ledger,
         last_ledger  = EXCLUDED.last_ledger,
         synced_at    = EXCLUDED.synced_at`,
      [
        cursor.network,
        cursor.cursor,
        cursor.firstLedger,
        cursor.lastLedger,
        new Date(cursor.syncedAt),
      ]
    );
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    this.initialised = false;
    if (pool) await pool.end();
  }

  private dids(): string {
    return `"${this.schema}"."${TABLE_DIDS}"`;
  }

  private cursors(): string {
    return `"${this.schema}"."${TABLE_CURSORS}"`;
  }

  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;
    const pg = await import('pg');
    // `pg` is CJS with a default export; the interop shape differs
    // between bundlers and tsconfig settings, so accept either.
    const PgPool = pg.Pool ?? pg.default.Pool;
    this.pool = new PgPool({
      connectionString: this.options.connectionString,
      max: this.options.maxConnections ?? 5,
      ...(this.options.ssl === true ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    return this.pool;
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* the connection is already broken; surface the original error */
      });
      throw err;
    } finally {
      client.release();
    }
  }
}

function toState(row: DidRow): DidIndexState {
  return {
    didId: row.did_id,
    controller: row.controller,
    version: row.version,
    deactivated: row.deactivated,
    createdLedger: row.created_ledger,
    updatedLedger: row.updated_ledger,
    lastEventId: row.last_event_id,
    lastEventLedger: row.last_event_ledger,
  };
}
