/**
 * Decoding of `did-stellar-registry` contract events.
 *
 * The contract publishes its events through soroban-sdk's
 * `#[contractevent]` macro (see `contracts-acta/contracts/
 * did-stellar-registry/src/events.rs`). With no `topics` or `data_format`
 * override the macro produces, for every event struct:
 *
 *   - **topics**: `[Symbol(snake_case(StructName))]` - a single segment,
 *     e.g. `did_controller_transferred`.
 *   - **data**: an `ScMap` of every struct field, keyed by the field name.
 *
 * That contract is fixed by the deployed WASM on both networks, so the
 * decoder below matches on the topic symbol and reads named map keys.
 * Anything it does not recognise (`contract_initialized`,
 * `admin_transferred`, future events) decodes to `null` and is skipped by
 * the caller rather than treated as an error.
 */

import { DID_ID_BYTES, encodeDidId } from '@acta-team/did-stellar';
import { scValToNative, type rpc, type xdr } from '@stellar/stellar-sdk';

/** The four registry events that move the controller → DIDs mapping. */
export type DidEventKind = 'registered' | 'updated' | 'controller_transferred' | 'deactivated';

/** Topic symbol → event kind. Mirrors the struct names in `events.rs`. */
export const DID_EVENT_TOPICS: Readonly<Record<string, DidEventKind>> = Object.freeze({
  did_registered: 'registered',
  did_updated: 'updated',
  did_controller_transferred: 'controller_transferred',
  did_deactivated: 'deactivated',
});

/** A decoded registry event, normalised across the four shapes. */
export interface DidRegistryEvent {
  readonly kind: DidEventKind;
  /** Bare 26-char base32 `didId`. */
  readonly didId: string;
  /** Present on `registered`. */
  readonly controller?: string;
  /** Present on `controller_transferred`. */
  readonly oldController?: string;
  /** Present on `controller_transferred`. */
  readonly newController?: string;
  /** Contract mutation counter carried by every event. */
  readonly version: number;
  readonly ledger: number;
  /** Soroban RPC event id - zero-padded and lexicographically sortable. */
  readonly eventId: string;
  readonly txHash: string;
  readonly ledgerClosedAt: string;
}

/**
 * Decode one raw RPC event into a {@link DidRegistryEvent}.
 *
 * Returns `null` - never throws - for events that are not part of the
 * DID lifecycle, that came from a reverted contract call, or whose shape
 * does not match the expected ABI. A malformed event must not stall the
 * ingestion loop.
 */
export function decodeRegistryEvent(raw: rpc.Api.EventResponse): DidRegistryEvent | null {
  // Events from a failed inner call are still returned by getEvents but
  // never took effect on the ledger.
  if (raw.inSuccessfulContractCall === false) return null;

  const topic = raw.topic[0];
  if (!topic) return null;

  const name = safeNative(topic);
  if (typeof name !== 'string') return null;
  const kind = DID_EVENT_TOPICS[name];
  if (!kind) return null;

  const data = safeNative(raw.value);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const fields = data as Record<string, unknown>;

  const didId = decodeDidIdField(fields['did_id']);
  if (didId === null) return null;

  const version = decodeU32Field(fields['version']);
  if (version === null) return null;

  const base = {
    kind,
    didId,
    version,
    ledger: raw.ledger,
    eventId: raw.id,
    txHash: raw.txHash,
    ledgerClosedAt: raw.ledgerClosedAt,
  } as const;

  if (kind === 'registered') {
    const controller = decodeAddressField(fields['controller']);
    if (controller === null) return null;
    return { ...base, controller };
  }

  if (kind === 'controller_transferred') {
    const oldController = decodeAddressField(fields['old_controller']);
    const newController = decodeAddressField(fields['new_controller']);
    if (oldController === null || newController === null) return null;
    return { ...base, oldController, newController };
  }

  return base;
}

/**
 * Decode a page of raw events, dropping anything unrecognised.
 * Order is preserved: the RPC returns events in ledger order.
 */
export function decodeRegistryEvents(raws: readonly rpc.Api.EventResponse[]): DidRegistryEvent[] {
  const out: DidRegistryEvent[] = [];
  for (const raw of raws) {
    const decoded = decodeRegistryEvent(raw);
    if (decoded) out.push(decoded);
  }
  return out;
}

/**
 * Compare two Soroban RPC event ids. The RPC formats them as
 * `{zero-padded toid}-{zero-padded event index}`, so plain lexicographic
 * comparison is also chronological.
 */
export function compareEventIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function safeNative(val: xdr.ScVal): unknown {
  try {
    return scValToNative(val);
  } catch {
    return undefined;
  }
}

/** `BytesN<16>` → canonical base32 `didId`. */
function decodeDidIdField(value: unknown): string | null {
  if (!(value instanceof Uint8Array) || value.length !== DID_ID_BYTES) return null;
  try {
    return encodeDidId(Uint8Array.from(value));
  } catch {
    return null;
  }
}

function decodeU32Field(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  // `scValToNative` widens some integer widths to bigint on other paths.
  if (typeof value === 'bigint' && value >= 0n && value <= 0xff_ff_ff_ffn) return Number(value);
  return null;
}

/** Soroban `Address` → strkey. `scValToNative` already yields the strkey string. */
function decodeAddressField(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}
