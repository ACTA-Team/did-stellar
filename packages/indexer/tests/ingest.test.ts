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

import { syncNetwork } from '../src/ingest';
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
  /** Records the ledger holds, keyed by didId. Absent = no storage entry. */
  readonly records?: Record<string, DidRecord>;
}

/** Minimal `rpc.Server` stand-in. Records every request it served. */
class FakeRpc {
  readonly getEventsCalls: unknown[] = [];
  readonly ledgerEntryCalls: number[] = [];

  constructor(private readonly opts: FakeRpcOptions) {}

  get oldestLedger(): number {
    return this.opts.oldestLedger ?? 1;
  }

  getHealth(): Promise<rpc.Api.GetHealthResponse> {
    return Promise.resolve({
      status: 'healthy',
      latestLedger: this.opts.latestLedger ?? 1000,
      oldestLedger: this.oldestLedger,
      ledgerRetentionWindow: 17_280,
    });
  }

  getEvents(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    this.getEventsCalls.push(request);
    const limit = request.limit ?? 100;

    let offset = 0;
    if ('cursor' in request && request.cursor) {
      const parsed = Number.parseInt(request.cursor, 10);
      if (Number.isNaN(parsed)) return Promise.reject(new Error('invalid cursor'));
      offset = parsed;
    } else if ('startLedger' in request && request.startLedger !== undefined) {
      if (request.startLedger < this.oldestLedger) {
        return Promise.reject(
          new Error('startLedger must be within the ledger retention window: oldest ledger is 500')
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
    expect(result.fromLedger).toBe(500);
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

    expect(result.fromLedger).toBe(500);
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
    expect(result.fromLedger).toBe(500);
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
