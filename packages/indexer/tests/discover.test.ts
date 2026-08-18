/**
 * Bootstrap discovery tests.
 *
 * The centrepiece is `reproduces the mainnet blind spot`: it builds the
 * exact situation that made the deployed index answer "this wallet holds
 * nothing" for every mainnet wallet - DIDs registered well before the RPC
 * retention floor, and no activity inside the window - and asserts that
 * the index is empty without a bootstrap and correct with one.
 *
 * The fake archival endpoint returns the same wire shape the real one
 * does: `_embedded.records[]` with unpadded `{toid}-{index}` ids and raw
 * base64 `topicsXdr` / `bodyXdr`, built from the same helpers that
 * synthesise the RPC payloads.
 */

import { describe, expect, it } from 'vitest';

import { bootstrapNetwork, discoverEvents, type FetchLike } from '../src/discover';
import { DidIndexer } from '../src/indexer';
import { listDidsByController } from '../src/query';
import { MemoryIndexStore } from '../src/store/memory';

import {
  DEFAULT_CONTRACT as CONTRACT,
  FakeRpc,
  record,
  registeredEvent,
  transferredEvent,
  unrelatedEvent,
} from './helpers';

import type { rpc } from '@stellar/stellar-sdk';

const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const DID_B = 'ceirceirceirceirceirceirce';
const DID_C = 'mfrggzdfmztwq2lknnwg23tpoa';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

// The real mainnet numbers this fix came out of: the newest DID sits
// ~111k ledgers below the retention floor, so the RPC window is empty.
const REGISTERED_LEDGER = 63_783_428;
const OLDEST_LEDGER = 63_894_558;
const LATEST_LEDGER = 64_015_517;

/** A TOID packs the ledger into its high 32 bits, the way Stellar does. */
function toid(ledger: number, index = 1): string {
  return ((BigInt(ledger) << 32n) | BigInt(index)).toString();
}

/**
 * Reshape an RPC event payload into an archival-index record: unpadded
 * `{toid}-{index}` id, base64 topics and body, no txHash.
 */
function remoteRecord(event: rpc.Api.EventResponse, index = 0): Record<string, unknown> {
  return {
    id: `${toid(event.ledger)}-${String(index).padStart(4, '0')}`,
    ts: 1_780_000_000 + event.ledger,
    contract: CONTRACT,
    topics: ['irrelevant'],
    topicsXdr: event.topic.map((t) => t.toXDR('base64')),
    bodyXdr: event.value.toXDR('base64'),
  };
}

interface FakeRemoteOptions {
  readonly records: Record<string, unknown>[];
  readonly pageLimit?: number;
  /** Fail every request with this status. */
  readonly failWith?: { status: number; statusText: string };
  /** Body to return instead of a well-formed envelope. */
  readonly body?: unknown;
}

function fakeRemote(opts: FakeRemoteOptions): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const pageLimit = opts.pageLimit ?? 200;

  const fetchImpl: FetchLike = (url) => {
    calls.push(url);
    if (opts.failWith) {
      return Promise.resolve({
        ok: false,
        status: opts.failWith.status,
        statusText: opts.failWith.statusText,
        json: () => Promise.resolve({}),
      });
    }
    if (opts.body !== undefined) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(opts.body),
      });
    }

    const parsed = new URL(url, 'https://example.test');
    const cursor = parsed.searchParams.get('cursor');
    const start = cursor === null ? 0 : opts.records.findIndex((r) => r['id'] === cursor) + 1;
    const page = opts.records.slice(start, start + pageLimit);
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ _embedded: { records: page } }),
    });
  };

  return { fetchImpl, calls };
}

/**
 * A fake RPC whose event window starts at `OLDEST_LEDGER`, so anything
 * registered earlier is simply not in the stream, while
 * `getLedgerEntries` still answers for those DIDs. That asymmetry between
 * event retention and ledger state is exactly what the bootstrap
 * exploits, and what these tests are built around.
 */
function blindRpc(opts: {
  events?: rpc.Api.EventResponse[];
  records?: Record<string, DidRecordLike>;
}): FakeRpc {
  return new FakeRpc({
    events: opts.events ?? [],
    oldestLedger: OLDEST_LEDGER,
    latestLedger: LATEST_LEDGER,
    ...(opts.records ? { records: opts.records } : {}),
  });
}

type DidRecordLike = ReturnType<typeof record>;

/** A runtime entry for a network, as `DidIndexer` builds them internally. */
function runtime(rpcServer: FakeRpc): Record<string, unknown> {
  return {
    network: 'mainnet',
    config: { rpcUrl: 'https://rpc.test', registryContractId: CONTRACT },
    rpcServer: rpcServer.asServer(),
    lastError: null,
    needsSweep: false,
    sweepAfter: undefined,
    bootstrap: 'pending',
  };
}

describe('discoverEvents', () => {
  it('walks the whole history and decodes with the production decoder', async () => {
    const { fetchImpl } = fakeRemote({
      records: [
        remoteRecord(unrelatedEvent(REGISTERED_LEDGER - 100)),
        remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: 1_000 })),
        remoteRecord(registeredEvent({ didId: DID_B, controller: ALICE, ledger: 2_000 })),
      ],
    });

    const result = await discoverEvents({
      network: 'mainnet',
      registryContractId: CONTRACT,
      fetchImpl,
    });

    // The unrelated `contract_initialized` is counted raw but not decoded.
    expect(result.rawEvents).toBe(3);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.didId)).toEqual([DID_A, DID_B]);
    expect(result.events[0]?.controller).toBe(ALICE);
    expect(result.fromLedger).toBe(1_000);
    expect(result.toLedger).toBe(REGISTERED_LEDGER - 100);
  });

  it('pages until the history is drained', async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: 1_000 + i }))
    );
    const { fetchImpl, calls } = fakeRemote({ records, pageLimit: 2 });

    const result = await discoverEvents({
      network: 'testnet',
      registryContractId: CONTRACT,
      fetchImpl,
      pageLimit: 2,
    });

    expect(result.events).toHaveLength(5);
    expect(calls).toHaveLength(3); // 2 + 2 + 1 (short page ends the walk)
    expect(calls[0]).toContain('/testnet/contract/');
    expect(calls[1]).toContain('cursor=');
  });

  it('pads event ids so a DID that mutated twice keeps its newest state', async () => {
    // A 9-digit toid followed by a 10-digit one: unpadded, string
    // comparison would sort the older event above the newer one and
    // `reduceEvent` would discard the transfer.
    const { fetchImpl } = fakeRemote({
      records: [
        remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: 1 })),
        remoteRecord(
          transferredEvent({
            didId: DID_A,
            oldController: ALICE,
            newController: BOB,
            version: 2,
            ledger: 3,
          })
        ),
      ],
    });

    const store = new MemoryIndexStore();
    await store.init();
    const result = await discoverEvents({
      network: 'mainnet',
      registryContractId: CONTRACT,
      fetchImpl,
    });
    await store.applyEvents('mainnet', result.events);

    expect((await store.listByController('mainnet', BOB)).map((d) => d.didId)).toEqual([DID_A]);
    expect(await store.listByController('mainnet', ALICE)).toEqual([]);
  });

  it('treats 404 as an empty history, not an error', async () => {
    const { fetchImpl } = fakeRemote({
      records: [],
      failWith: { status: 404, statusText: 'Not Found' },
    });
    const result = await discoverEvents({
      network: 'mainnet',
      registryContractId: CONTRACT,
      fetchImpl,
    });
    expect(result.events).toEqual([]);
    expect(result.pages).toBe(0);
  });

  it('throws on a server error rather than reporting a partial history', async () => {
    const { fetchImpl } = fakeRemote({
      records: [],
      failWith: { status: 503, statusText: 'Service Unavailable' },
    });
    await expect(
      discoverEvents({ network: 'mainnet', registryContractId: CONTRACT, fetchImpl })
    ).rejects.toThrow(/503/);
  });

  it('skips malformed records instead of failing the walk', async () => {
    const good = remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: 10 }));
    const { fetchImpl } = fakeRemote({
      records: [
        { id: 'not-a-toid', topicsXdr: ['@@@'], bodyXdr: '@@@', ts: 1 },
        { nonsense: true },
        good,
      ],
    });
    const result = await discoverEvents({
      network: 'mainnet',
      registryContractId: CONTRACT,
      fetchImpl,
    });
    expect(result.events.map((e) => e.didId)).toEqual([DID_A]);
  });
});

describe('bootstrapNetwork', () => {
  it('confirms every discovered DID against the ledger', async () => {
    const store = new MemoryIndexStore();
    await store.init();
    const { fetchImpl } = fakeRemote({
      records: [
        remoteRecord(
          registeredEvent({ didId: DID_A, controller: ALICE, ledger: REGISTERED_LEDGER })
        ),
        remoteRecord(
          registeredEvent({ didId: DID_B, controller: ALICE, ledger: REGISTERED_LEDGER })
        ),
      ],
    });

    const result = await bootstrapNetwork({
      store,
      network: 'mainnet',
      registryContractId: CONTRACT,
      // The ledger says DID_B actually moved to Bob and DID_A is as claimed.
      rpcServer: blindRpc({
        records: {
          [DID_A]: record({ controller: ALICE }),
          [DID_B]: record({ controller: BOB, version: 2 }),
        },
      }).asServer(),
      fetchImpl,
    });

    expect(result.discovered).toBe(2);
    expect(result.confirmed).toBe(2);
    expect(result.dropped).toBe(0);
    // The ledger wins over what the archival history claimed.
    expect((await store.listByController('mainnet', ALICE)).map((d) => d.didId)).toEqual([DID_A]);
    expect((await store.listByController('mainnet', BOB)).map((d) => d.didId)).toEqual([DID_B]);
  });

  it('drops DIDs the ledger has no entry for, so a bad source cannot inject rows', async () => {
    const store = new MemoryIndexStore();
    await store.init();
    const { fetchImpl } = fakeRemote({
      records: [
        remoteRecord(
          registeredEvent({ didId: DID_A, controller: ALICE, ledger: REGISTERED_LEDGER })
        ),
        // Fabricated: the archival source claims Alice holds this too.
        remoteRecord(
          registeredEvent({ didId: DID_C, controller: ALICE, ledger: REGISTERED_LEDGER })
        ),
      ],
    });

    const result = await bootstrapNetwork({
      store,
      network: 'mainnet',
      registryContractId: CONTRACT,
      rpcServer: blindRpc({ records: { [DID_A]: record({ controller: ALICE }) } }).asServer(),
      fetchImpl,
    });

    expect(result.dropped).toBe(1);
    expect((await store.listByController('mainnet', ALICE)).map((d) => d.didId)).toEqual([DID_A]);
  });

  it('records the contract first ledger as coverage, so a later sync cannot narrow it', async () => {
    const store = new MemoryIndexStore();
    await store.init();
    const { fetchImpl } = fakeRemote({
      records: [
        remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: 63_270_607 })),
        remoteRecord(
          registeredEvent({ didId: DID_B, controller: ALICE, ledger: REGISTERED_LEDGER })
        ),
      ],
    });

    await bootstrapNetwork({
      store,
      network: 'mainnet',
      registryContractId: CONTRACT,
      rpcServer: blindRpc({
        records: {
          [DID_A]: record({ controller: ALICE, createdLedger: 63_270_607 }),
          [DID_B]: record({ controller: ALICE }),
        },
      }).asServer(),
      fetchImpl,
    });

    const cursor = await store.getCursor('mainnet');
    expect(cursor?.firstLedger).toBe(63_270_607);
    // No paging token: the RPC stream is separate and must start at its floor.
    expect(cursor?.cursor).toBeNull();
  });
});

describe('DidIndexer bootstrap', () => {
  /** The bug this whole change exists for. */
  it('reproduces the mainnet blind spot and closes it', async () => {
    const history = [
      remoteRecord(registeredEvent({ didId: DID_A, controller: ALICE, ledger: REGISTERED_LEDGER })),
      remoteRecord(registeredEvent({ didId: DID_B, controller: ALICE, ledger: 63_360_942 })),
    ];
    const ledgerRecords = {
      [DID_A]: record({ controller: ALICE }),
      [DID_B]: record({ controller: ALICE, createdLedger: 63_360_942 }),
    };

    // --- Without a bootstrap: the RPC window holds nothing ------------
    const before = new MemoryIndexStore();
    const blind = new DidIndexer({
      store: before,
      networks: { mainnet: { rpcUrl: 'https://rpc.test', registryContractId: CONTRACT } },
      bootstrap: { mode: 'off' },
    });
    // Both DIDs are far below the retention floor, so `getEvents` is empty.
    Reflect.set(blind, 'runtimes', [runtime(blindRpc({ events: [], records: ledgerRecords }))]);
    await blind.start();
    blind.stop();

    const blindResult = await listDidsByController({
      store: before,
      network: 'mainnet',
      controller: ALICE,
    });
    // This is production today: a wallet that holds two DIDs is told it holds none.
    expect(blindResult.dids).toEqual([]);

    // --- With a bootstrap: both DIDs are found and ledger-confirmed ---
    const after = new MemoryIndexStore();
    const { fetchImpl } = fakeRemote({ records: history });
    const seeing = new DidIndexer({
      store: after,
      networks: { mainnet: { rpcUrl: 'https://rpc.test', registryContractId: CONTRACT } },
      bootstrap: { mode: 'auto', fetchImpl },
    });
    Reflect.set(seeing, 'runtimes', [runtime(blindRpc({ events: [], records: ledgerRecords }))]);
    await seeing.start();
    seeing.stop();

    const seen = await listDidsByController({
      store: after,
      network: 'mainnet',
      controller: ALICE,
    });
    expect(seen.dids.map((d) => d.didId).sort()).toEqual([DID_B, DID_A].sort());

    const status = await seeing.status();
    expect(status.find((s) => s.network === 'mainnet')?.bootstrap).toBe('ok');
  });

  it('keeps starting when the archival source is down', async () => {
    const store = new MemoryIndexStore();
    const { fetchImpl } = fakeRemote({
      records: [],
      failWith: { status: 500, statusText: 'Internal Server Error' },
    });
    const indexer = new DidIndexer({
      store,
      networks: { mainnet: { rpcUrl: 'https://rpc.test', registryContractId: CONTRACT } },
      bootstrap: { mode: 'auto', fetchImpl },
    });
    Reflect.set(indexer, 'runtimes', [runtime(blindRpc({ events: [] }))]);

    await expect(indexer.start()).resolves.toBeUndefined();
    indexer.stop();
    expect(indexer.isBackfilled).toBe(true);

    // The failure has to be visible: the index is silently incomplete.
    const status = await indexer.status();
    expect(status.find((s) => s.network === 'mainnet')?.bootstrap).toBe('failed');
  });

  it('skips the bootstrap when the store already has a cursor', async () => {
    const store = new MemoryIndexStore();
    await store.init();
    await store.setCursor({
      network: 'mainnet',
      cursor: 'abc',
      firstLedger: 1,
      lastLedger: 2,
      syncedAt: new Date().toISOString(),
    });
    const { fetchImpl, calls } = fakeRemote({ records: [] });

    const indexer = new DidIndexer({
      store,
      networks: { mainnet: { rpcUrl: 'https://rpc.test', registryContractId: CONTRACT } },
      bootstrap: { mode: 'auto', fetchImpl },
    });
    Reflect.set(indexer, 'runtimes', [runtime(blindRpc({ events: [] }))]);

    await indexer.bootstrapOnce();
    expect(calls).toEqual([]);
    const status = await indexer.status();
    expect(status.find((s) => s.network === 'mainnet')?.bootstrap).toBe('skipped');
  });
});
