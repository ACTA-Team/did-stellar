/**
 * Projection tests - these are the acceptance criteria for the reverse
 * index, expressed against the in-memory store:
 *
 *   1. A wallet with N DIDs gets all N back, deactivated ones included
 *      and flagged.
 *   2. A DID received via `transfer_controller` appears under the new
 *      controller and disappears from the old one.
 *   3. A wallet with no DIDs gets an empty list.
 */

import { describe, expect, it } from 'vitest';

import { decodeRegistryEvents } from '../src/events';
import { listDidsByController } from '../src/query';
import { reduceEvent } from '../src/reduce';
import { MemoryIndexStore } from '../src/store/memory';

import { deactivatedEvent, registeredEvent, transferredEvent, updatedEvent } from './helpers';

import type { rpc } from '@stellar/stellar-sdk';

// Canonical 26-char base32 didIds: 26 chars carry 130 bits, so the last
// two bits must be zero. These come from `encodeDidId` on fixed bytes.
const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const DID_B = 'ceirceirceirceirceirceirce';
const DID_C = 'gmztgmztgmztgmztgmztgmztgm';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const NOBODY = 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3';

async function seed(events: rpc.Api.EventResponse[]): Promise<MemoryIndexStore> {
  const store = new MemoryIndexStore();
  await store.init();
  await store.applyEvents('testnet', decodeRegistryEvents(events));
  return store;
}

describe('controller → DIDs projection', () => {
  it('returns every DID a wallet holds, deactivated ones included and flagged', async () => {
    const store = await seed([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      registeredEvent({ didId: DID_B, controller: ALICE, ledger: 101 }),
      registeredEvent({ didId: DID_C, controller: ALICE, ledger: 102 }),
      deactivatedEvent({ didId: DID_B, version: 2, ledger: 110 }),
    ]);

    const { dids } = await listDidsByController({ store, network: 'testnet', controller: ALICE });

    expect(dids).toHaveLength(3);
    expect(dids.map((d) => d.did)).toEqual([
      `did:stellar:testnet:${DID_A}`,
      `did:stellar:testnet:${DID_B}`,
      `did:stellar:testnet:${DID_C}`,
    ]);
    expect(dids.map((d) => d.deactivated)).toEqual([false, true, false]);
    // A deactivated DID keeps its history rather than being hidden.
    expect(dids[1]).toMatchObject({ version: 2, createdLedger: 101, updatedLedger: 110 });
  });

  it('moves a transferred DID to the new controller and off the old one', async () => {
    const store = await seed([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      registeredEvent({ didId: DID_B, controller: ALICE, ledger: 101 }),
      transferredEvent({
        didId: DID_A,
        oldController: ALICE,
        newController: BOB,
        version: 2,
        ledger: 120,
      }),
    ]);

    const alice = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    const bob = await listDidsByController({ store, network: 'testnet', controller: BOB });

    expect(alice.dids.map((d) => d.didId)).toEqual([DID_B]);
    expect(bob.dids.map((d) => d.didId)).toEqual([DID_A]);
    expect(bob.dids[0]).toMatchObject({ controller: BOB, version: 2, createdLedger: 100 });
  });

  it('returns an empty list - not an error - for a wallet with no DIDs', async () => {
    const store = await seed([registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 })]);
    const { dids } = await listDidsByController({
      store,
      network: 'testnet',
      controller: NOBODY,
    });
    expect(dids).toEqual([]);
  });

  it('scopes the index per network', async () => {
    const store = await seed([registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 })]);
    const mainnet = await listDidsByController({ store, network: 'mainnet', controller: ALICE });
    expect(mainnet.dids).toEqual([]);
  });

  it('tracks a DID handed back to its original controller', async () => {
    const store = await seed([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      transferredEvent({
        didId: DID_A,
        oldController: ALICE,
        newController: BOB,
        version: 2,
        ledger: 110,
      }),
      transferredEvent({
        didId: DID_A,
        oldController: BOB,
        newController: ALICE,
        version: 3,
        ledger: 120,
      }),
    ]);

    const alice = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    const bob = await listDidsByController({ store, network: 'testnet', controller: BOB });
    expect(alice.dids.map((d) => d.didId)).toEqual([DID_A]);
    expect(bob.dids).toEqual([]);
  });

  it('reports the ingested ledger range with the answer', async () => {
    const store = await seed([registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 })]);
    await store.setCursor({
      network: 'testnet',
      cursor: 'c1',
      firstLedger: 50,
      lastLedger: 200,
      syncedAt: '2026-08-17T00:00:00.000Z',
    });
    const result = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(result.coverage).toEqual({
      fromLedger: 50,
      toLedger: 200,
      syncedAt: '2026-08-17T00:00:00.000Z',
    });
    expect(result.verified).toBe(false);
  });
});

describe('idempotency and ordering', () => {
  it('is a no-op when the same page is replayed', async () => {
    const page = [
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      transferredEvent({
        didId: DID_A,
        oldController: ALICE,
        newController: BOB,
        version: 2,
        ledger: 110,
      }),
    ];
    const store = await seed(page);
    const second = await store.applyEvents('testnet', decodeRegistryEvents(page));

    expect(second.written).toBe(0);
    const bob = await listDidsByController({ store, network: 'testnet', controller: BOB });
    expect(bob.dids.map((d) => d.didId)).toEqual([DID_A]);
  });

  it('does not roll a row back when a stale event arrives late', async () => {
    const store = await seed([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      transferredEvent({
        didId: DID_A,
        oldController: ALICE,
        newController: BOB,
        version: 2,
        ledger: 110,
      }),
    ]);
    // The `did_updated` at ledger 105 predates the transfer.
    await store.applyEvents(
      'testnet',
      decodeRegistryEvents([updatedEvent({ didId: DID_A, version: 99, ledger: 105 })])
    );

    const bob = await listDidsByController({ store, network: 'testnet', controller: BOB });
    expect(bob.dids[0]).toMatchObject({ controller: BOB, version: 2 });
  });
});

describe('reduceEvent', () => {
  it('leaves the controller unknown when the first event seen is not a register', async () => {
    // The backfill window can start after a DID was registered; the
    // resulting row is invisible to listings until reconciliation runs.
    const store = await seed([updatedEvent({ didId: DID_A, version: 7, ledger: 100 })]);
    const states = await store.getStates('testnet', [DID_A]);
    expect(states.get(DID_A)).toMatchObject({ controller: null, version: 7 });

    const alice = await listDidsByController({ store, network: 'testnet', controller: ALICE });
    expect(alice.dids).toEqual([]);

    // ...but the sweep can find it.
    const unresolved = await store.listDidIds('testnet', { limit: 10, onlyUnresolved: true });
    expect(unresolved).toEqual([DID_A]);
  });

  it('returns the previous state object unchanged for a stale event', () => {
    const [register, stale] = decodeRegistryEvents([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      updatedEvent({ didId: DID_A, version: 2, ledger: 90 }),
    ]);
    if (!register || !stale) throw new Error('fixture decode failed');
    const first = reduceEvent(null, register);
    expect(reduceEvent(first, stale)).toBe(first);
  });
});
