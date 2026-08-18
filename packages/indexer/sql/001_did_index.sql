-- did:stellar reverse index - controller → DIDs.
--
-- Apply with: psql "$DATABASE_URL" -f sql/001_did_index.sql
-- or drop into supabase/migrations/ and run `supabase db push`.
--
-- The indexer also creates this schema itself on boot (see
-- src/store/schema.ts); this file exists for teams that prefer their
-- schema under migration control and run the service with a role that
-- has no DDL grant.

CREATE TABLE IF NOT EXISTS public.did_stellar_index (
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

CREATE INDEX IF NOT EXISTS did_stellar_index_controller_idx
  ON public.did_stellar_index (network, controller)
  WHERE controller IS NOT NULL;

CREATE INDEX IF NOT EXISTS did_stellar_index_unresolved_idx
  ON public.did_stellar_index (network, did_id)
  WHERE controller IS NULL;

CREATE TABLE IF NOT EXISTS public.did_stellar_index_cursor (
  network      text        NOT NULL PRIMARY KEY CHECK (network IN ('mainnet', 'testnet')),
  cursor       text        NULL,
  first_ledger integer     NOT NULL DEFAULT 0,
  last_ledger  integer     NOT NULL DEFAULT 0,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

-- The index mirrors public blockchain data, so reads are safe to expose.
-- Writes belong to the indexer's service role only.
ALTER TABLE public.did_stellar_index        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.did_stellar_index_cursor ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'did_stellar_index'
      AND policyname = 'did_stellar_index_read'
  ) THEN
    CREATE POLICY did_stellar_index_read
      ON public.did_stellar_index FOR SELECT USING (true);
  END IF;
END
$$;
