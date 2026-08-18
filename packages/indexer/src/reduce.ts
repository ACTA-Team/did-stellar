/**
 * Pure event → state reduction.
 *
 * Both store backends fold events through this single function so the
 * in-memory store and the Postgres store can never drift apart. The
 * reducer is total, idempotent and order-safe:
 *
 *   - **Idempotent** - an event whose id is not strictly newer than the
 *     row's `lastEventId` is ignored, so replaying a page after a crash
 *     (or a cursor rewind after an RPC retention gap) is a no-op.
 *   - **Order-safe** - out-of-order delivery cannot roll a row backwards.
 *   - **Total** - an event for a DID the index has never seen still
 *     produces a row, with `controller: null` when the event does not
 *     carry one. `reconcile()` later fills it from the ledger.
 */

import { compareEventIds, type DidRegistryEvent } from './events';

import type { DidIndexState, IndexedDid } from './types';
import type { NetworkType } from '@acta-team/did-stellar';

/**
 * Fold one event into a DID's state.
 *
 * Returns the previous state unchanged when the event is stale, so
 * callers can cheaply detect a no-op with `next === prev`.
 */
export function reduceEvent(prev: DidIndexState | null, event: DidRegistryEvent): DidIndexState {
  if (prev && compareEventIds(event.eventId, prev.lastEventId) <= 0) return prev;

  const stamp = {
    lastEventId: event.eventId,
    lastEventLedger: event.ledger,
    updatedLedger: event.ledger,
    version: event.version,
  } as const;

  switch (event.kind) {
    case 'registered':
      // `register` is the first event a DID can emit, so it defines the
      // whole row even if a later event arrived first during a backfill.
      return {
        didId: event.didId,
        controller: event.controller ?? null,
        deactivated: prev?.deactivated ?? false,
        createdLedger: event.ledger,
        ...stamp,
      };

    case 'controller_transferred':
      return {
        didId: event.didId,
        controller: event.newController ?? null,
        deactivated: prev?.deactivated ?? false,
        createdLedger: prev?.createdLedger ?? 0,
        ...stamp,
      };

    case 'deactivated':
      return {
        didId: event.didId,
        controller: prev?.controller ?? null,
        deactivated: true,
        createdLedger: prev?.createdLedger ?? 0,
        ...stamp,
      };

    case 'updated':
      // `update` cannot change the controller; it only bumps the version.
      return {
        didId: event.didId,
        controller: prev?.controller ?? null,
        deactivated: prev?.deactivated ?? false,
        createdLedger: prev?.createdLedger ?? 0,
        ...stamp,
      };
  }
}

/**
 * Fold a batch of events, grouped by `didId`, on top of the rows the
 * caller already read. Returns only the rows that actually changed.
 */
export function reduceEvents(
  current: ReadonlyMap<string, DidIndexState>,
  events: readonly DidRegistryEvent[]
): Map<string, DidIndexState> {
  const changed = new Map<string, DidIndexState>();
  for (const event of events) {
    const prev = changed.get(event.didId) ?? current.get(event.didId) ?? null;
    const next = reduceEvent(prev, event);
    if (next !== prev) changed.set(event.didId, next);
  }
  return changed;
}

/** Distinct `didId`s touched by a batch of events. */
export function affectedDidIds(events: readonly DidRegistryEvent[]): string[] {
  return [...new Set(events.map((e) => e.didId))];
}

/**
 * Project internal state onto the public row shape. Returns `null` for
 * rows whose controller is still unknown - those are not answers to
 * "which DIDs does this controller hold?" until reconciliation runs.
 */
export function toIndexedDid(network: NetworkType, state: DidIndexState): IndexedDid | null {
  if (state.controller === null) return null;
  return {
    network,
    did: `did:stellar:${network}:${state.didId}`,
    didId: state.didId,
    controller: state.controller,
    version: state.version,
    deactivated: state.deactivated,
    createdLedger: state.createdLedger,
    updatedLedger: state.updatedLedger,
  };
}
