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

import { decodeDidId } from '@acta-team/did-stellar';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

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
