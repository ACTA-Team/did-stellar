/**
 * PostHog analytics — opt-in, privacy-preserving, no-op by default.
 *
 * This is an identity service, so two rules shape the design:
 *
 *   1. **Opt-in.** With no `POSTHOG_API_KEY` configured, `buildAnalytics`
 *      returns a no-op that allocates nothing and sends nothing. The
 *      service must run identically with analytics off — that is the
 *      trust-minimised default.
 *
 *   2. **No identifiers on the wire.** A `did:stellar:...` and its keys
 *      are identifying data. We never send the raw DID; the per-event
 *      `distinctId` is a truncated SHA-256 of the DID (`anonId`). Event
 *      properties carry only cardinalities and enums (network, counts,
 *      error codes) — never record contents, XDR, or public keys.
 */

import { createHash } from 'node:crypto';

import { PostHog } from 'posthog-node';

export interface Analytics {
  /**
   * Fire-and-forget event capture. Never throws and never blocks the
   * request path — the underlying client batches and flushes async.
   */
  capture(event: string, properties?: Record<string, unknown>, distinctId?: string): void;
  /** Flush any buffered events. Called once on graceful shutdown. */
  shutdown(): Promise<void>;
}

export interface AnalyticsConfig {
  readonly apiKey: string | null;
  readonly host: string;
}

/** Stable pseudonymous id for a DID — never the DID itself. */
export function anonId(did: string): string {
  return createHash('sha256').update(did).digest('hex').slice(0, 32);
}

/** Fallback distinctId for events not scoped to a single DID. */
const SERVICE_ID = 'did-stellar-api';

const NOOP: Analytics = {
  capture: () => {},
  shutdown: async () => {},
};

export function buildAnalytics(cfg: AnalyticsConfig): Analytics {
  if (!cfg.apiKey) return NOOP;

  const client = new PostHog(cfg.apiKey, {
    host: cfg.host,
    // Batch aggressively but bound latency so events from a short-lived
    // request survive even under low traffic.
    flushAt: 20,
    flushInterval: 10_000,
  });

  return {
    capture(event, properties = {}, distinctId = SERVICE_ID): void {
      client.capture({ distinctId, event, properties });
    },
    async shutdown(): Promise<void> {
      await client.shutdown();
    },
  };
}
