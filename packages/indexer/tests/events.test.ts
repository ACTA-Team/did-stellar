import { describe, expect, it } from 'vitest';

import { compareEventIds, decodeRegistryEvent, decodeRegistryEvents } from '../src/events';

import {
  deactivatedEvent,
  eventId,
  registeredEvent,
  revertedRegisteredEvent,
  transferredEvent,
  unrelatedEvent,
  updatedEvent,
} from './helpers';

const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('decodeRegistryEvent', () => {
  it('decodes did_registered with its controller', () => {
    const decoded = decodeRegistryEvent(
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 })
    );
    expect(decoded).toMatchObject({
      kind: 'registered',
      didId: DID_A,
      controller: ALICE,
      version: 1,
      ledger: 100,
    });
  });

  it('decodes did_controller_transferred with both controllers', () => {
    const decoded = decodeRegistryEvent(
      transferredEvent({
        didId: DID_A,
        oldController: ALICE,
        newController: BOB,
        version: 2,
        ledger: 110,
      })
    );
    expect(decoded).toMatchObject({
      kind: 'controller_transferred',
      oldController: ALICE,
      newController: BOB,
      version: 2,
    });
  });

  it('decodes did_deactivated and did_updated', () => {
    expect(
      decodeRegistryEvent(deactivatedEvent({ didId: DID_A, version: 3, ledger: 120 }))
    ).toMatchObject({ kind: 'deactivated', version: 3 });
    expect(
      decodeRegistryEvent(updatedEvent({ didId: DID_A, version: 4, ledger: 130 }))
    ).toMatchObject({ kind: 'updated', version: 4 });
  });

  it('ignores events from other topics on the same contract', () => {
    expect(decodeRegistryEvent(unrelatedEvent(140))).toBeNull();
  });

  it('ignores events from a reverted contract call', () => {
    expect(
      decodeRegistryEvent(revertedRegisteredEvent({ didId: DID_A, controller: ALICE, ledger: 150 }))
    ).toBeNull();
  });

  it('drops unrecognised events from a batch without failing the batch', () => {
    const decoded = decodeRegistryEvents([
      registeredEvent({ didId: DID_A, controller: ALICE, ledger: 100 }),
      unrelatedEvent(101),
      updatedEvent({ didId: DID_A, version: 2, ledger: 102 }),
    ]);
    expect(decoded).toHaveLength(2);
    expect(decoded.map((e) => e.kind)).toEqual(['registered', 'updated']);
  });
});

describe('compareEventIds', () => {
  it('orders ids chronologically as plain strings', () => {
    expect(compareEventIds(eventId(9), eventId(10))).toBe(-1);
    expect(compareEventIds(eventId(10), eventId(9))).toBe(1);
    expect(compareEventIds(eventId(10), eventId(10))).toBe(0);
    expect(compareEventIds(eventId(10, 1), eventId(10, 2))).toBe(-1);
  });
});
