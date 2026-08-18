/**
 * In-memory {@link DidIndexStore}.
 *
 * The default backend. Everything lives in two `Map`s per network, so a
 * deployment needs no database at all - it rebuilds the index from the
 * RPC event stream on boot. That costs one backfill per restart but keeps
 * the "clone, `pnpm start`, done" property the rest of this service has.
 *
 * A secondary `controller → didIds` map keeps `listByController` O(1) in
 * the number of DIDs held rather than O(n) over the whole index; it is
 * maintained in lockstep with the primary map on every write.
 */

import { reduceEvents, toIndexedDid } from '../reduce';

import type { DidRegistryEvent } from '../events';
import type { DidIndexState, IndexCursor, IndexedDid } from '../types';
import type { ApplyEventsResult, DidIndexStore } from './types';
import type { NetworkType } from '@acta-team/did-stellar';

interface NetworkShard {
  readonly byDidId: Map<string, DidIndexState>;
  readonly byController: Map<string, Set<string>>;
  cursor: IndexCursor | null;
}

export class MemoryIndexStore implements DidIndexStore {
  readonly kind = 'memory' as const;

  private readonly shards = new Map<NetworkType, NetworkShard>();

  init(): Promise<void> {
    return Promise.resolve();
  }

  applyEvents(
    network: NetworkType,
    events: readonly DidRegistryEvent[]
  ): Promise<ApplyEventsResult> {
    if (events.length === 0) return Promise.resolve({ seen: 0, written: 0 });
    const shard = this.shard(network);
    const changed = reduceEvents(shard.byDidId, events);
    for (const state of changed.values()) this.write(shard, state);
    return Promise.resolve({ seen: events.length, written: changed.size });
  }

  putStates(network: NetworkType, states: readonly DidIndexState[]): Promise<void> {
    const shard = this.shard(network);
    for (const state of states) this.write(shard, state);
    return Promise.resolve();
  }

  removeDids(network: NetworkType, didIds: readonly string[]): Promise<void> {
    const shard = this.shard(network);
    for (const didId of didIds) {
      const existing = shard.byDidId.get(didId);
      if (!existing) continue;
      this.unlinkController(shard, existing);
      shard.byDidId.delete(didId);
    }
    return Promise.resolve();
  }

  getStates(network: NetworkType, didIds: readonly string[]): Promise<Map<string, DidIndexState>> {
    const shard = this.shard(network);
    const out = new Map<string, DidIndexState>();
    for (const didId of didIds) {
      const state = shard.byDidId.get(didId);
      if (state) out.set(didId, state);
    }
    return Promise.resolve(out);
  }

  listByController(network: NetworkType, controller: string): Promise<IndexedDid[]> {
    const shard = this.shard(network);
    const didIds = shard.byController.get(controller);
    if (!didIds || didIds.size === 0) return Promise.resolve([]);

    const rows: IndexedDid[] = [];
    for (const didId of didIds) {
      const state = shard.byDidId.get(didId);
      if (!state) continue;
      const row = toIndexedDid(network, state);
      if (row) rows.push(row);
    }
    return Promise.resolve(sortRows(rows));
  }

  listDidIds(
    network: NetworkType,
    opts: { readonly limit: number; readonly after?: string; readonly onlyUnresolved?: boolean }
  ): Promise<string[]> {
    const shard = this.shard(network);
    const after = opts.after;
    const ids: string[] = [];
    for (const [didId, state] of shard.byDidId) {
      if (after !== undefined && didId <= after) continue;
      if (opts.onlyUnresolved === true && state.controller !== null) continue;
      ids.push(didId);
    }
    ids.sort();
    return Promise.resolve(ids.slice(0, Math.max(0, opts.limit)));
  }

  countDids(network: NetworkType): Promise<number> {
    return Promise.resolve(this.shard(network).byDidId.size);
  }

  getCursor(network: NetworkType): Promise<IndexCursor | null> {
    return Promise.resolve(this.shard(network).cursor);
  }

  setCursor(cursor: IndexCursor): Promise<void> {
    this.shard(cursor.network).cursor = cursor;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.shards.clear();
    return Promise.resolve();
  }

  private shard(network: NetworkType): NetworkShard {
    let shard = this.shards.get(network);
    if (!shard) {
      shard = { byDidId: new Map(), byController: new Map(), cursor: null };
      this.shards.set(network, shard);
    }
    return shard;
  }

  /** Write a row and keep the controller index consistent. */
  private write(shard: NetworkShard, state: DidIndexState): void {
    const previous = shard.byDidId.get(state.didId);
    if (previous && previous.controller !== state.controller) {
      this.unlinkController(shard, previous);
    }
    shard.byDidId.set(state.didId, state);
    if (state.controller === null) return;
    let held = shard.byController.get(state.controller);
    if (!held) {
      held = new Set();
      shard.byController.set(state.controller, held);
    }
    held.add(state.didId);
  }

  private unlinkController(shard: NetworkShard, state: DidIndexState): void {
    if (state.controller === null) return;
    const held = shard.byController.get(state.controller);
    if (!held) return;
    held.delete(state.didId);
    if (held.size === 0) shard.byController.delete(state.controller);
  }
}

/** Stable ordering: oldest DID first, `didId` as the tiebreaker. */
export function sortRows(rows: IndexedDid[]): IndexedDid[] {
  return rows.sort((a, b) => {
    if (a.createdLedger !== b.createdLedger) return a.createdLedger - b.createdLedger;
    return a.didId < b.didId ? -1 : a.didId > b.didId ? 1 : 0;
  });
}
