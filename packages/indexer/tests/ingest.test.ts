/**
 * Ingestion tests against a fake Soroban RPC.
 *
 * The fake implements only the three methods the indexer calls
 * (`getHealth`, `getEvents`, `getLedgerEntries`) with the real pagination
 * semantics: pages are capped at `limit`, a short page means "caught up",
 * and a cursor older than `oldestLedger` is rejected the way the RPC
 * rejects it.
 */

import { buildDidRecordLedgerKey, decodeDidId, encodeDidRecord } from '@acta-team/did-stellar';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
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

import { registeredEvent, transferredEvent, updatedEvent } from './helpers';

import type { DidRecord } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

const CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';
const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const DID_B = 'ceirceirceirceirceirceirce';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

interface FakeRpcOptions {
  readonly events: rpc.Api.EventResponse[];
  readonly oldestLedger?: number;
  readonly latestLedger?: number;
  /**
   * The floor `getEvents` actually enforces, when it differs from what
   * `getHealth` reports. Models the real race on mainnet: the retention
   * window slides forward as ledgers close, so the value read from
   * `getHealth` can already be stale by the time `getEvents` is served.
   */
  readonly eventsOldestLedger?: number;
  /** When set, `getHealth` reports this floor from the 2nd call onwards. */
  readonly oldestLedgerAfterRefresh?: number;
  /** Records the ledger holds, keyed by didId. Absent = no storage entry. */
  readonly records?: Record<string, DidRecord>;
}

/**
 * Soroban RPC surfaces failures as plain JSON-RPC objects, not `Error`
 * instances. Throwing the real shape here is what caught the mainnet bug
 * where `String(err)` collapsed to `[object Object]`.
 */
function rpcError(message: string): unknown {
  return { type: 'Object', message, stack: '', code: -32600 };
}

/** Minimal `rpc.Server` stand-in. Records every request it served. */
class FakeRpc {
  readonly getEventsCalls: unknown[] = [];
  readonly ledgerEntryCalls: number[] = [];
  healthCalls = 0;

  constructor(private readonly opts: FakeRpcOptions) {}

  get oldestLedger(): number {
    return this.opts.oldestLedger ?? 1;
  }

  getHealth(): Promise<rpc.Api.GetHealthResponse> {
    this.healthCalls += 1;
    const refreshed = this.opts.oldestLedgerAfterRefresh;
    const oldestLedger =
      refreshed !== undefined && this.healthCalls > 1 ? refreshed : this.oldestLedger;
    return Promise.resolve({
      status: 'healthy',
      latestLedger: this.opts.latestLedger ?? 1000,
      oldestLedger,
      ledgerRetentionWindow: 17_280,
    });
  }

  getEvents(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    this.getEventsCalls.push(request);
    const limit = request.limit ?? 100;

    let offset = 0;
    if ('cursor' in request && request.cursor) {
      const parsed = Number.parseInt(request.cursor, 10);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Soroban RPC rejects with a plain object, and that is what this fake must reproduce.
      if (Number.isNaN(parsed)) return Promise.reject(rpcError('invalid cursor'));
      offset = parsed;
    } else if ('startLedger' in request && request.startLedger !== undefined) {
      // The window the RPC will actually serve, which may already have
      // moved past what `getHealth` reported.
      const serveFrom = this.opts.eventsOldestLedger ?? this.oldestLedger;
      if (request.startLedger < serveFrom) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above: the non-Error shape is the regression under test.
        return Promise.reject(
          rpcError(
            `startLedger must be within the ledger range: ${serveFrom} - ${
              this.opts.latestLedger ?? 1000
            }`
          )
        );
      }
      offset = this.opts.events.findIndex((e) => e.ledger >= request.startLedger);
      if (offset < 0) offset = this.opts.events.length;
    }

    const slice = this.opts.events.slice(offset, offset + limit);
    return Promise.resolve({
      events: slice,
      cursor: String(offset + slice.length),
      latestLedger: this.opts.latestLedger ?? 1000,
      oldestLedger: this.oldestLedger,
      latestLedgerCloseTime: '0',
      oldestLedgerCloseTime: '0',
    });
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse> {
    this.ledgerEntryCalls.push(keys.length);
    const records = this.opts.records ?? {};
    const entries = [];
    for (const [didId, record] of Object.entries(records)) {
      const wanted = buildDidRecordLedgerKey(CONTRACT, decodeDidId(didId)).toXDR('base64');
      const match = keys.find((k) => k.toXDR('base64') === wanted);
      if (!match) continue;
      entries.push({
        key: match,
        val: contractDataEntry(match, onLedgerRecordScVal(record)),
        lastModifiedLedgerSeq: record.updatedLedger,
      });
    }
    return Promise.resolve({
      entries,
      latestLedger: this.opts.latestLedger ?? 1000,
    } as rpc.Api.GetLedgerEntriesResponse);
  }

  /** Cast to the real type at the seam; the fake covers the used surface. */
  asServer(): rpc.Server {
    return this as unknown as rpc.Server;
  }
}

/**
 * A record as the *ledger* holds it.
 *
 * `encodeDidRecord` deliberately stubs the four contract-managed fields
 * (`version`, `created_ledger`, `updated_ledger`, `deactivated`) because
 * the contract overwrites them on `register`. A read comes back with the
 * real values, so the fake ledger must patch them in - otherwise the test
 * would be asserting against a shape the chain never returns.
 */
function onLedgerRecordScVal(record: DidRecord): xdr.ScVal {
  const patched: Record<string, xdr.ScVal> = {
    version: nativeToScVal(record.version, { type: 'u32' }),
    created_ledger: nativeToScVal(record.createdLedger, { type: 'u32' }),
    updated_ledger: nativeToScVal(record.updatedLedger, { type: 'u32' }),
    deactivated: xdr.ScVal.scvBool(record.deactivated),
  };
  return xdr.ScVal.scvMap(
    encodeDidRecord(record)
      .map()
      ?.map((e) => {
        const key = e.key().sym().toString();
        const override = patched[key];
        return override ? new xdr.ScMapEntry({ key: e.key(), val: override }) : e;
      }) ?? []
  );
}

function contractDataEntry(key: xdr.LedgerKey, val: xdr.ScVal): xdr.LedgerEntryData {
  const cd = key.contractData();
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: cd.contract(),
      key: cd.key(),
      durability: cd.durability(),
      val,
    })
  );
}

function record(overrides: Partial<DidRecord> & Pick<DidRecord, 'controller'>): DidRecord {
  return {
    authentication: [{ publicKeyMultibase: 'z6MkwBw2szL21i4Ym1wqzV8bPWwJyp1WDt8oRofTEs9ZntSq' }],
    assertionMethod: [],
    keyAgreement: [],
    services: [],
    version: 1,
    createdLedger: 100,
    updatedLedger: 100,
    deactivated: false,
    ...overrides,
  };
}

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
