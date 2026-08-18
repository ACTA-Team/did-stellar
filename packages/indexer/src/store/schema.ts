/**
 * DDL for the Postgres / Supabase backend.
 *
 * Kept as a TS constant (rather than a `.sql` file read at runtime) so
 * the compiled `dist/` needs no asset copying and the schema can never
 * drift from the code that queries it. The same statements are mirrored
 * as a plain migration in `sql/001_did_index.sql` for teams that apply
 * schema changes through Supabase migrations instead of at boot.
 *
 * Everything is `IF NOT EXISTS`, so `init()` is safe on every boot and
 * concurrent replicas racing to create the table is a no-op.
 */

/** Default schema. Overridable via `DID_INDEX_PG_SCHEMA`. */
export const DEFAULT_SCHEMA = 'public';

/** Row table. `(network, did_id)` is the primary key - a DID is per-network. */
export const TABLE_DIDS = 'did_stellar_index';
/** One ingestion cursor per network. */
export const TABLE_CURSORS = 'did_stellar_index_cursor';

export function buildSchemaSql(schema: string): string {
  const dids = `"${schema}"."${TABLE_DIDS}"`;
  const cursors = `"${schema}"."${TABLE_CURSORS}"`;
  return `
CREATE TABLE IF NOT EXISTS ${dids} (
  network           text    NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  did_id            text    NOT NULL CHECK (did_id ~ '^[a-z2-7]{26}$'),
  controller        text    NULL,
  version           integer NOT NULL DEFAULT 0,
  deactivated       boolean NOT NULL DEFAULT false,
  created_ledger    integer NOT NULL DEFAULT 0,
  updated_ledger    integer NOT NULL DEFAULT 0,
  last_event_id     text    NOT NULL DEFAULT '',
  last_event_ledger integer NOT NULL DEFAULT 0,
  indexed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, did_id)
);

-- The reverse lookup this whole package exists for.
CREATE INDEX IF NOT EXISTS ${TABLE_DIDS}_controller_idx
  ON ${dids} (network, controller)
  WHERE controller IS NOT NULL;

-- Reconciliation sweeps: find rows whose controller the event stream
-- could not supply (registered before the RPC retention window).
CREATE INDEX IF NOT EXISTS ${TABLE_DIDS}_unresolved_idx
  ON ${dids} (network, did_id)
  WHERE controller IS NULL;

CREATE TABLE IF NOT EXISTS ${cursors} (
  network      text        NOT NULL PRIMARY KEY CHECK (network IN ('mainnet', 'testnet')),
  cursor       text        NULL,
  first_ledger integer     NOT NULL DEFAULT 0,
  last_ledger  integer     NOT NULL DEFAULT 0,
  synced_at    timestamptz NOT NULL DEFAULT now()
);
`;
}
