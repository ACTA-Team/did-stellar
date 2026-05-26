/**
 * Content negotiation for the DID Resolver endpoint.
 *
 * Per spec v0.1 §5.1 + DIF resolver conventions:
 *
 *  - `application/did+ld+json` (default) — the full document with JSON-LD `@context`.
 *  - `application/did+json` — same payload minus the `@context` field.
 *
 * Any other Accept value falls back to `did+ld+json`.
 */

import type { Request } from 'express';

import type { DidDocument } from '@acta-team/did-stellar';

export type DidResponseContentType = 'application/did+ld+json' | 'application/did+json';

export function negotiateContentType(req: Request): DidResponseContentType {
  const accept = req.headers.accept ?? '';
  // Prefer `did+ld+json` when present or as the default.
  if (accept.includes('application/did+json') && !accept.includes('application/did+ld+json')) {
    return 'application/did+json';
  }
  return 'application/did+ld+json';
}

/**
 * Strip the `@context` field for `application/did+json` responses,
 * keeping every other field intact. Returns a fresh object — never
 * mutates the input.
 */
export function projectDocumentForContentType(
  doc: DidDocument,
  contentType: DidResponseContentType
): Omit<DidDocument, '@context'> | DidDocument {
  if (contentType === 'application/did+json') {
    const { '@context': _ctx, ...rest } = doc;
    void _ctx;
    return rest;
  }
  return doc;
}
