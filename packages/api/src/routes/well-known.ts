/**
 * `GET /.well-known/acta-did-stellar.json` - network configuration manifest.
 *
 * One stable URL that tells an integrator (or a tool configuring itself)
 * where everything lives: the `did-stellar-registry` per network, the ACTA
 * credential contracts built on top of it, and this resolver's endpoints.
 *
 * Registry contract ids come from the live {@link AppConfig}, so the
 * manifest always names the registry this deployment actually resolves
 * against. The credential-layer entries (vault factory, vault template, ACTA
 * API) are not something this service talks to, so they are pinned here to
 * the canonical deployments recorded in `contracts-acta/docs/deployments/`.
 */

import { Router, type Request, type Response } from 'express';

import type { AppConfig } from '../config';
import type { NetworkType } from '@acta-team/did-stellar';

export const WELL_KNOWN_PATH = '/.well-known/acta-did-stellar.json';

/** Bumped when the manifest shape changes incompatibly. */
const MANIFEST_VERSION = 1;

const NETWORK_PASSPHRASES: Readonly<Record<NetworkType, string>> = {
  mainnet: 'Public Global Stellar Network ; September 2015',
  testnet: 'Test SDF Network ; September 2015',
};

/** Canonical ACTA credential-layer deployments (contracts-acta/docs/deployments). */
const ACTA_CREDENTIALS: Readonly<
  Record<
    NetworkType,
    {
      readonly vcVaultFactory: { readonly contractId: string; readonly version: string };
      readonly vcVaultTemplate: { readonly wasmHash: string; readonly version: string };
      readonly api: string;
    }
  >
> = {
  mainnet: {
    vcVaultFactory: {
      contractId: 'CCWNZ6UMUXCDOVP2TWOPVLI4KP4VY4YF7VKPN6XLYVHNFAT24NDB33CX',
      version: '0.1.0',
    },
    vcVaultTemplate: {
      wasmHash: '2bd0323a98acb8469606808368da6c79824f2dd8391494b94ddbeb3d22c1a957',
      version: '0.4.0',
    },
    api: 'https://production-api.acta.build',
  },
  testnet: {
    vcVaultFactory: {
      contractId: 'CDRFQRIP4FA3WMPWCSAM3XEY6EM6EGKRYZRSCSVZ5NHCF6AGEVR2XEPQ',
      version: '0.1.0',
    },
    vcVaultTemplate: {
      wasmHash: '2bd0323a98acb8469606808368da6c79824f2dd8391494b94ddbeb3d22c1a957',
      version: '0.4.0',
    },
    api: 'https://sandbox-api.acta.build',
  },
};

const NETWORKS: readonly NetworkType[] = ['mainnet', 'testnet'];

export interface WellKnownRouterDeps {
  readonly config: Pick<AppConfig, 'networks'>;
}

export function wellKnownRouter(deps: WellKnownRouterDeps): Router {
  const router = Router();

  router.get(WELL_KNOWN_PATH, (req: Request, res: Response) => {
    // Advertise the host the manifest was fetched from, so a staging or
    // self-hosted deployment points at itself rather than at did.acta.build.
    const baseUrl = `${req.protocol}://${req.get('host') ?? 'did.acta.build'}`;

    const networks: Record<string, unknown> = {};
    for (const network of NETWORKS) {
      const registryContractId = deps.config.networks[network].registryContractId;
      // An unconfigured network is left out rather than advertised as empty.
      if (!registryContractId) continue;
      networks[network] = {
        networkPassphrase: NETWORK_PASSPHRASES[network],
        didStellarRegistry: { contractId: registryContractId },
        ...ACTA_CREDENTIALS[network],
      };
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      manifestVersion: MANIFEST_VERSION,
      method: 'did:stellar',
      specification:
        'https://github.com/ACTA-Team/did-stellar/blob/main/docs/method/did-stellar-method.md',
      resolver: {
        baseUrl,
        universalResolver: `${baseUrl}/1.0/identifiers/{did}`,
        rawRecord: `${baseUrl}/v1/dids/stellar/{did}`,
        openApi: `${baseUrl}/openapi.json`,
      },
      networks,
    });
  });

  return router;
}
