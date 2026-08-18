/**
 * Test helpers: synthesise the exact `getEvents` payloads the deployed
 * registry contract produces.
 *
 * The shapes here are not guesses. soroban-sdk's `#[contractevent]`, with
 * no `topics` / `data_format` override (which is how `events.rs` uses it),
 * emits `topics = [Symbol(snake_case(StructName))]` and an `ScMap` of the
 * struct fields keyed by field name. Building the ScVals by hand keeps the
 * decoder honest about the real wire format rather than about a mock.
 */

import { buildDidRecordLedgerKey, decodeDidId, encodeDidRecord } from '@acta-team/did-stellar';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import type { DidRecord } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

/** Zero-padded so ids sort the same way the RPC's do. */
export function eventId(ledger: number, index = 1): string {
  return `${String(ledger).padStart(19, '0')}-${String(index).padStart(10, '0')}`;
}

function scMap(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  // The macro sorts data keys; ScMap requires sorted keys anyway.
  return xdr.ScVal.scvMap(
    Object.keys(entries)
      .sort()
      .map(
        (key) =>
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(key),
            val: entries[key] as xdr.ScVal,
          })
      )
  );
}

function baseEvent(
  topic: string,
  data: xdr.ScVal,
  ledger: number,
  index: number
): rpc.Api.EventResponse {
  return {
    id: eventId(ledger, index),
    type: 'contract',
    ledger,
    ledgerClosedAt: new Date(1_700_000_000_000 + ledger * 5000).toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: `tx-${ledger}-${index}`,
    topic: [xdr.ScVal.scvSymbol(topic)],
    value: data,
  };
}

const didIdScVal = (didId: string): xdr.ScVal =>
  xdr.ScVal.scvBytes(Buffer.from(decodeDidId(didId)));

const u32 = (n: number): xdr.ScVal => nativeToScVal(n, { type: 'u32' });

const addr = (a: string): xdr.ScVal => Address.fromString(a).toScVal();

export function registeredEvent(opts: {
  didId: string;
  controller: string;
  version?: number;
  ledger: number;
  index?: number;
}): rpc.Api.EventResponse {
  return baseEvent(
    'did_registered',
    scMap({
      did_id: didIdScVal(opts.didId),
      controller: addr(opts.controller),
      version: u32(opts.version ?? 1),
    }),
    opts.ledger,
    opts.index ?? 1
  );
}

export function updatedEvent(opts: {
  didId: string;
  version: number;
  ledger: number;
  index?: number;
}): rpc.Api.EventResponse {
  return baseEvent(
    'did_updated',
    scMap({ did_id: didIdScVal(opts.didId), version: u32(opts.version) }),
    opts.ledger,
    opts.index ?? 1
  );
}

export function transferredEvent(opts: {
  didId: string;
  oldController: string;
  newController: string;
  version: number;
  ledger: number;
  index?: number;
}): rpc.Api.EventResponse {
  return baseEvent(
    'did_controller_transferred',
    scMap({
      did_id: didIdScVal(opts.didId),
      old_controller: addr(opts.oldController),
      new_controller: addr(opts.newController),
      version: u32(opts.version),
    }),
    opts.ledger,
    opts.index ?? 1
  );
}

export function deactivatedEvent(opts: {
  didId: string;
  version: number;
  ledger: number;
  index?: number;
}): rpc.Api.EventResponse {
  return baseEvent(
    'did_deactivated',
    scMap({ did_id: didIdScVal(opts.didId), version: u32(opts.version) }),
    opts.ledger,
    opts.index ?? 1
  );
}

/** An event the index must ignore: `ContractInitialized` from the same contract. */
export function unrelatedEvent(ledger: number, index = 1): rpc.Api.EventResponse {
  return baseEvent(
    'contract_initialized',
    scMap({ admin: addr('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ') }),
    ledger,
    index
  );
}

/** A reverted inner call still shows up in `getEvents`; it must not count. */
export function revertedRegisteredEvent(opts: {
  didId: string;
  controller: string;
  ledger: number;
}): rpc.Api.EventResponse {
  return {
    ...registeredEvent(opts),
    inSuccessfulContractCall: false,
  };
}

// --- Fake Soroban RPC --------------------------------------------------------

/**
 * The registry these fakes answer for. Tests that build ledger keys must
 * use the same id, so it lives here rather than in each test file.
 */
export const DEFAULT_CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';

/**
 * Soroban RPC surfaces failures as plain JSON-RPC objects, not `Error`
 * instances. Throwing the real shape here is what caught the mainnet bug
 * where `String(err)` collapsed to `[object Object]`.
 */
function rpcError(message: string): unknown {
  return { type: 'Object', message, stack: '', code: -32600 };
}

export interface FakeRpcOptions {
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
  /** Registry the records belong to. Defaults to {@link DEFAULT_CONTRACT}. */
  readonly contractId?: string;
}

/** Minimal `rpc.Server` stand-in. Records every request it served. */
export class FakeRpc {
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
      const contractId = this.opts.contractId ?? DEFAULT_CONTRACT;
      const wanted = buildDidRecordLedgerKey(contractId, decodeDidId(didId)).toXDR('base64');
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

export function record(overrides: Partial<DidRecord> & Pick<DidRecord, 'controller'>): DidRecord {
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
