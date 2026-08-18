/**
 * Single source of truth for every external identifier the site shows.
 * Values mirror `@acta-team/did-stellar`'s `network.ts` and the method
 * doc. Keep them in sync when the SDK ships a new deployment.
 */

export const SITE = {
  name: 'did:stellar',
  tagline: 'The official DID method anchored on Stellar.',
  description:
    'did:stellar is a W3C-compliant Decentralized Identifier anchored in a Soroban registry contract, designed and built by ACTA. Resolve any DID with nothing but a Stellar RPC endpoint, no hosted service required.',
  /** Documentation lives on the ACTA docs site, not on this one. */
  docsUrl: 'https://docs.acta.build/did-overview',
  resolverUrl: 'https://did.acta.build',
  swaggerUrl: 'https://did.acta.build/docs',
  openApiUrl: 'https://did.acta.build/openapi.json',
  repoUrl: 'https://github.com/ACTA-Team/did-stellar',
  npmUrl: 'https://www.npmjs.com/package/@acta-team/did-stellar',
  specUrl:
    'https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md',
  universalResolverUrl: 'https://dev.uniresolver.io/',
  actaUrl: 'https://acta.build',
  stellarUrl: 'https://stellar.org',
} as const;

export type NetworkId = 'testnet' | 'mainnet';

export const NETWORKS: Record<
  NetworkId,
  {
    label: string;
    rpcUrl: string;
    registryContractId: string;
    explorerBase: string;
  }
> = {
  testnet: {
    label: 'Testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    registryContractId: 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ',
    explorerBase: 'https://stellar.expert/explorer/testnet',
  },
  mainnet: {
    label: 'Mainnet',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    registryContractId: 'CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ',
    explorerBase: 'https://stellar.expert/explorer/public',
  },
};

/**
 * The site is a single page, so navigation is section anchors plus the
 * one link that leaves it: the documentation.
 */
export const NAV_LINKS: ReadonlyArray<{
  label: string;
  href: string;
  external?: boolean;
}> = [
  { label: 'Syntax', href: '/#anatomy' },
  { label: 'Registry', href: '/#registry' },
  { label: 'Resolve', href: '/#resolve' },
  { label: 'Trust model', href: '/#trust' },
  { label: 'Docs', href: SITE.docsUrl, external: true },
];
