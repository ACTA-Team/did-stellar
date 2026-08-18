/**
 * Ingestion tests against a fake Soroban RPC.
 *
 * The fake implements only the three methods the indexer calls
 * (`getHealth`, `getEvents`, `getLedgerEntries`) with the real pagination
 * semantics: pages are capped at `limit`, a short page means "caught up",
 * and a cursor older than `oldestLedger` is rejected the way the RPC
 * rejects it.
 */

import { describe, expect, it } from 'vitest';

import {
  errorMessage,
  isOutOfRangeError,
  RETENTION_SAFETY_MARGIN,
  syncNetwork,
} from '../src/ingest';
import { listDidsByController } from '../src/query';
import { readDidRecords, reconcile } from '../src/reconcile';
import { MemoryIndexStore } from '../src/store/memory';

import {
  DEFAULT_CONTRACT as CONTRACT,
  FakeRpc,
  record,
  registeredEvent,
  transferredEvent,
  updatedEvent,
} from './helpers';

const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const DID_B = 'ceirceirceirceirceirceirce';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('syncNetwork', () => {
  it('backfills from the retention floor and records the covered range', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      latestLedger: 900,
      events: [
        registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 }),
        registeredEvent({ didId: DID_B, controller: ALICE, ledger: 700 }),
      ],
    });

    const result = await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(result).toMatchObject({ seen: 2, decoded: 2, written: 2, truncated: false });
    // The floor carries RETENTION_SAFETY_MARGIN of headroom above the
    // RPC's reported oldestLedger.
    expect(result.fromLedger).toBe(500 + RETENTION_SAFETY_MARGIN);
    expect(result.toLedger).toBe(900);

    const { dids } = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(dids.map((d) => d.didId)).toEqual([DID_A, DID_B]);
  });

  it('clamps a startLedger below the retention floor instead of erroring', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
    });

    const result = await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
      startLedger: 1,
    });

    expect(result.fromLedger).toBe(500 + RETENTION_SAFETY_MARGIN);
    expect(result.decoded).toBe(1);
  });

  it('pages until the stream is drained', async () => {
    const store = new MemoryIndexStore();
    const events = Array.from({ length: 5 }, (_, i) =>
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 + i, index: i + 1 })
    );
    const rpcServer = new FakeRpc({ oldestLedger: 500, events });

    const result = await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
      pageLimit: 2,
    });

    expect(result.seen).toBe(5);
    expect(result.pages).toBe(3); // 2 + 2 + 1 (short page ends the loop)
  });

  it('resumes from the stored cursor on the next sync', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
    });
    const opts = {
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    } as const;

    await syncNetwork(opts);
    const second = await syncNetwork(opts);

    expect(second.seen).toBe(0);
    const lastCall = rpcServer.getEventsCalls[rpcServer.getEventsCalls.length - 1];
    expect(lastCall).toMatchObject({ cursor: '1' });
  });

  it('rewinds to the retention floor when the stored cursor has aged out', async () => {
    const store = new MemoryIndexStore();
    await store.setCursor({
      network: 'testnet',
      cursor: 'stale-cursor',
      firstLedger: 10,
      lastLedger: 20,
      syncedAt: new Date(0).toISOString(),
    });
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
    });

    const result = await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(result.rewound).toBe(true);
    expect(result.fromLedger).toBe(500 + RETENTION_SAFETY_MARGIN);
    expect(result.decoded).toBe(1);
  });
});

describe('reconcile', () => {
  it('fills in a controller the event window could not supply', async () => {
    const store = new MemoryIndexStore();
    // Only a `did_updated` is in the window - the register predates it.
    await syncNetwork({
      store,
      rpcServer: new FakeRpc({
        oldestLedger: 500,
        events: [updatedEvent({ didId: DID_A, version: 4, ledger: 600 })],
      }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    const before = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(before.dids).toEqual([]);

    const rpcServer = new FakeRpc({
      events: [],
      records: { [DID_A]: record({ controller: ALICE, version: 4, createdLedger: 42 }) },
    });
    const result = await reconcile({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
      onlyUnresolved: true,
    });

    expect(result).toMatchObject({ checked: 1, updated: 1, removed: 0 });
    const after = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(after.dids[0]).toMatchObject({ didId: DID_A, version: 4, createdLedger: 42 });
  });

  it('repairs a transfer the index missed, in one batched read', async () => {
    const store = new MemoryIndexStore();
    await syncNetwork({
      store,
      rpcServer: new FakeRpc({
        oldestLedger: 500,
        events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
      }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    // The ledger says BOB holds it now; the transfer event never arrived.
    const rpcServer = new FakeRpc({
      events: [],
      records: { [DID_A]: record({ controller: BOB, version: 2, updatedLedger: 700 }) },
    });
    const alice = await listDidsByController({
      store,
      network: 'testnet',
      controller: ALICE,
      verify: { rpcServer: rpcServer.asServer(), registryContractId: CONTRACT },
    });

    expect(alice.verified).toBe(true);
    expect(alice.dids).toEqual([]);
    expect(rpcServer.ledgerEntryCalls).toEqual([1]);

    const bob = await listDidsByController({ store, network: 'testnet', controller: BOB });
    expect(bob.dids.map((d) => d.didId)).toEqual([DID_A]);
  });

  it('drops a DID whose storage entry is gone', async () => {
    const store = new MemoryIndexStore();
    await syncNetwork({
      store,
      rpcServer: new FakeRpc({
        oldestLedger: 500,
        events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
      }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    const result = await reconcile({
      store,
      rpcServer: new FakeRpc({ events: [], records: {} }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(result).toMatchObject({ checked: 1, updated: 0, removed: 1 });
    const alice = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(alice.dids).toEqual([]);
  });

  it('leaves verified rows untouched when the ledger agrees', async () => {
    const store = new MemoryIndexStore();
    await syncNetwork({
      store,
      rpcServer: new FakeRpc({
        oldestLedger: 500,
        events: [
          registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 }),
          transferredEvent({
            didId: DID_A,
            oldController: ALICE,
            newController: BOB,
            version: 2,
            ledger: 700,
          }),
        ],
      }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    const result = await reconcile({
      store,
      rpcServer: new FakeRpc({
        events: [],
        records: {
          [DID_A]: record({ controller: BOB, version: 2, createdLedger: 600, updatedLedger: 700 }),
        },
      }).asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(result).toMatchObject({ checked: 1, updated: 0, removed: 0 });
  });
});

describe('readDidRecords', () => {
  it('reports a missing entry as null and skips undecodable ids', async () => {
    const rpcServer = new FakeRpc({
      events: [],
      records: { [DID_A]: record({ controller: ALICE }) },
    });
    const out = await readDidRecords({
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      didIds: [DID_A, DID_B, 'not-a-did-id'],
    });

    expect(out.get(DID_A)).toMatchObject({ controller: ALICE });
    expect(out.get(DID_B)).toBeNull();
    expect(out.has('not-a-did-id')).toBe(false);
  });

  it('chunks large key sets across requests', async () => {
    const rpcServer = new FakeRpc({ events: [], records: {} });
    await readDidRecords({
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      didIds: [DID_A, DID_B],
      chunkSize: 1,
    });
    expect(rpcServer.ledgerEntryCalls).toEqual([1, 1]);
  });
});

describe('retention-window boundary (mainnet regression)', () => {
  // `getHealth().oldestLedger` is a moving target: the window slides
  // forward every time a ledger closes, so the floor read moments ago can
  // already be rejected by `getEvents`. Live mainnet failed with
  // "startLedger must be within the ledger range: 63883575 - 64004534"
  // while getHealth had just reported 63882605.

  it('recovers when getEvents rejects the floor getHealth reported', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      // The window has already moved past 500 + margin by the time
      // getEvents is served; only a re-read of health reveals it.
      eventsOldestLedger: 700,
      oldestLedgerAfterRefresh: 700,
      events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 800 })],
    });

    const result = await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(result.decoded).toBe(1);
    expect(result.fromLedger).toBe(700 + RETENTION_SAFETY_MARGIN);
    expect(rpcServer.healthCalls).toBe(2);
  });

  it('gives up instead of spinning when a fresh floor does not help', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      // getEvents rejects everything and health never moves, so retrying
      // can never succeed. It must surface the error, not loop.
      eventsOldestLedger: 100_000,
      events: [],
    });

    await expect(
      syncNetwork({
        store,
        rpcServer: rpcServer.asServer(),
        registryContractId: CONTRACT,
        network: 'testnet',
      })
    ).rejects.toBeDefined();
    expect(rpcServer.healthCalls).toBe(2);
  });

  it('leaves the floor alone when the first request is accepted', async () => {
    const store = new MemoryIndexStore();
    const rpcServer = new FakeRpc({
      oldestLedger: 500,
      events: [registeredEvent({ didId: DID_A, controller: ALICE, ledger: 600 })],
    });

    await syncNetwork({
      store,
      rpcServer: rpcServer.asServer(),
      registryContractId: CONTRACT,
      network: 'testnet',
    });

    expect(rpcServer.healthCalls).toBe(1);
  });
});

describe('RPC error shapes', () => {
  // Soroban RPC rejects with a plain JSON-RPC object, never an Error.
  const RAW = {
    type: 'Object',
    message: 'startLedger must be within the ledger range: 1 - 2',
    code: -32600,
  };

  it('recognises an out-of-range error delivered as a plain object', () => {
    expect(isOutOfRangeError(RAW)).toBe(true);
    expect(isOutOfRangeError(new Error('startLedger must be within the ledger range: 1 - 2'))).toBe(
      true
    );
  });

  it('does not treat unrelated failures as out-of-range', () => {
    expect(isOutOfRangeError(new Error('socket hang up'))).toBe(false);
    expect(isOutOfRangeError({ message: 'internal server error', code: -32603 })).toBe(false);
  });

  it('extracts a readable message instead of [object Object]', () => {
    expect(errorMessage(RAW)).toBe(
      'startLedger must be within the ledger range: 1 - 2 (code -32600)'
    );
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('boom')).toBe('boom');
    // Exactly what the mainnet bug put in the log, which is why
    // errorMessage exists.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    expect(String(RAW)).toBe('[object Object]');
  });
});
