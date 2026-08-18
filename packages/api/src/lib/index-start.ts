/**
 * Bringing the reverse index up, and keeping it coming up.
 *
 * Starting the index is one network operation that can fail for reasons
 * that resolve themselves seconds later, and one that must not be left
 * failed: with the index down, `GET /v1/dids/stellar` answers an empty
 * list for every wallet. Empty is a valid answer, so nothing about the
 * response says anything is wrong - which is exactly why a failure here
 * has to be retried and reported rather than logged once and dropped.
 */

import type { Logger } from '../logger';

/** The slice of the index handle this module drives. */
export interface StartableIndex {
  start(): Promise<void>;
  /** Record why the last start attempt failed, for `/health`. */
  noteStartError(message: string | null): void;
}

/** First backoff step for index start retries. Doubles, capped below. */
const INDEX_START_BACKOFF_MS = 2_000;
/** Ceiling for that backoff. A dead database is retried once a minute. */
const INDEX_START_MAX_BACKOFF_MS = 60_000;

/**
 * Keep trying to start the index until it comes up or the process stops.
 *
 * One attempt is not enough. On a platform whose private network is not
 * ready the instant the container is - Railway's takes a moment - the
 * first connect fails with `ENOTFOUND` while nothing is actually wrong.
 * The store already retries that over a few seconds; this covers the
 * longer outages, a database still provisioning or briefly restarting.
 *
 * The alternative, which is what this replaces, was to log the error and
 * give up: a transient miss at boot left the index empty and every
 * controller listing silently wrong until someone redeployed. An index
 * that is late is recoverable; one that is dead until a human notices is
 * not.
 */
export function startIndexWithRetry(
  index: StartableIndex,
  logger: Logger,
  isStopped: () => boolean,
  opts: { readonly baseDelayMs?: number; readonly maxDelayMs?: number } = {}
): void {
  const maxDelayMs = opts.maxDelayMs ?? INDEX_START_MAX_BACKOFF_MS;
  let delayMs = opts.baseDelayMs ?? INDEX_START_BACKOFF_MS;

  const attempt = (): void => {
    if (isStopped()) return;
    index
      .start()
      .then(() => {
        index.noteStartError(null);
      })
      .catch((err: unknown) => {
        if (isStopped()) return;
        const message = err instanceof Error ? err.message : String(err);
        index.noteStartError(message);
        logger.error(
          { err, retryInMs: delayMs },
          'did index failed to start; controller listings stay empty until it does'
        );
        setTimeout(attempt, delayMs).unref();
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      });
  };

  attempt();
}
