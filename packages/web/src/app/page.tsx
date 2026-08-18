import { ArrowUpRight, ExternalLink, KeyRound, ShieldCheck, Terminal } from 'lucide-react';

import { DidAnatomy } from '@/components/did-anatomy';
import { Hero } from '@/components/hero';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { NETWORKS, SITE, type NetworkId } from '@/lib/site';

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Trust-minimized',
    body: 'Resolution needs a Stellar RPC URL and the registry contract ID. Nothing else. ACTA can go offline and every did:stellar keeps resolving.',
  },
  {
    icon: KeyRound,
    title: 'The DID is not the wallet',
    body: 'The 128-bit identifier is generated with a CSPRNG and has no relationship to any G… address. Rotate the controller key and the DID survives.',
  },
  {
    icon: Terminal,
    title: 'W3C DID Core 1.1',
    body: 'Multikey verification methods, fragment-only relationships, tombstones on deactivation, and a DIF Universal Resolver driver in the SDK.',
  },
] as const;

const WALLET_FACTS = [
  {
    title: 'Survives key rotation',
    body: 'If the controller account is compromised, transfer control to a new wallet. The DID string never changes.',
  },
  {
    title: 'One wallet, many DIDs',
    body: 'There is no derivation path to collide with, so a single account can control any number of identities.',
  },
  {
    title: 'The wallet stays private',
    body: 'The controller lives inside the on-chain record, never inside the identifier you hand out.',
  },
] as const;

const PATHS = [
  {
    title: 'curl',
    body: 'No install. Hit the hosted DIF-compatible endpoint.',
    code: `curl did.acta.build/1.0/identifiers/$DID`,
  },
  {
    title: 'SDK',
    body: 'Talks straight to Stellar RPC. No ACTA dependency.',
    code: `const { didDocument } = await resolveDidStellar(did)`,
  },
  {
    title: 'DIF driver',
    body: 'Drop it into an existing resolver instance.',
    code: `new Resolver({ ...getResolver() })`,
  },
] as const;

const GUARANTEES = [
  {
    claim: 'The SDK reads directly from Stellar RPC.',
    detail:
      'Resolution issues a getLedgerEntries call and decodes the record locally. It does not know did.acta.build exists.',
  },
  {
    claim: 'The hosted resolver is a convenience, not a dependency.',
    detail:
      'did.acta.build is a stateless wrapper for non-JS consumers and for the DIF Universal Resolver listing. It holds no state you cannot rebuild from the ledger.',
  },
  {
    claim: 'Identity and credentials are separate trust domains.',
    detail:
      'The ACTA credentials service deliberately does not import this SDK. A compromise on one side does not propagate to the other.',
  },
  {
    claim: 'There is no authentication to resolve.',
    detail:
      'No API key, no account, no rate-limit tier gates reading a DID Document. Verification that requires permission is not verification.',
  },
] as const;

const DEPENDENCIES = [
  {
    title: 'The Stellar network itself',
    body: 'Resolution is only as available and as final as the ledger you read it from. You choose the RPC endpoint, including your own node.',
  },
  {
    title: 'The registry contract',
    body: 'Records live in one Soroban contract per network. Its address is public and its code is open; you verify it once and pin it.',
  },
  {
    title: "The controller's key hygiene",
    body: 'Whoever holds the controller account can rotate keys, transfer control or deactivate the DID. The method protects the identifier, not the operator.',
  },
] as const;

export default function Home() {
  return (
    <>
      <Hero />

      <DidAnatomy />

      {/* ---- Why this method ------------------------------------------ */}
      <section className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            Why this method
          </p>
          <h2 className="font-display mt-4 text-4xl sm:text-5xl">
            Verification is public. So is the infrastructure.
          </h2>
        </Reveal>

        <Stagger className="mt-10 grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <StaggerItem key={pillar.title} className="h-full">
              <Card className="flex h-full flex-col transition-colors duration-300 hover:border-primary/30">
                <CardHeader>
                  <pillar.icon className="size-4 text-primary" />
                  <CardTitle className="mt-3">{pillar.title}</CardTitle>
                  <CardDescription>{pillar.body}</CardDescription>
                </CardHeader>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* ---- Not the wallet ------------------------------------------- */}
      <section id="identity" className="border-t border-border bg-foreground/2">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Identity</p>
            <h2 className="font-display mt-4 text-4xl sm:text-5xl">
              An identity you keep when the keys change.
            </h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              The identifier is opaque on purpose. It is not a hash of an account, not a derivation
              of one, and it reveals nothing about the wallet that controls it.
            </p>
          </Reveal>

          <Stagger className="mt-10 grid gap-4 md:grid-cols-3">
            {WALLET_FACTS.map((fact) => (
              <StaggerItem
                key={fact.title}
                className="rounded-xl border border-border bg-background p-5 transition-colors duration-300 hover:border-primary/30"
              >
                <h3 className="text-sm font-semibold">{fact.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{fact.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---- Registry -------------------------------------------------- */}
      <section id="registry" className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Registry</p>
            <h2 className="font-display mt-4 text-4xl sm:text-5xl">The contracts of record.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              One deployment per network, one persistent storage entry per DID. Pin these addresses
              and you never need to ask anyone where a DID lives.
            </p>
          </Reveal>

          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2">
            {(Object.keys(NETWORKS) as NetworkId[]).map((id) => {
              const network = NETWORKS[id];
              return (
                <StaggerItem
                  key={id}
                  className="flex flex-col rounded-xl border border-border bg-card/50 p-5 transition-colors duration-300 hover:border-primary/30"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-sm font-semibold">{id}</h3>
                    <Badge variant={id === 'testnet' ? 'accent' : 'outline'}>
                      {id === 'testnet' ? 'SDK default' : 'Production'}
                    </Badge>
                  </div>

                  <dl className="mt-4 flex flex-col gap-3">
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Registry contract
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
                        {network.registryContractId}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Default RPC
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">{network.rpcUrl}</dd>
                    </div>
                  </dl>

                  <a
                    href={`${network.explorerBase}/contract/${network.registryContractId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-1.5 text-sm text-foreground underline decoration-ring/60 underline-offset-4 hover:decoration-ring"
                  >
                    View on stellar.expert
                    <ExternalLink className="size-3.5" />
                  </a>
                </StaggerItem>
              );
            })}
          </Stagger>

          <Reveal className="mt-4 rounded-xl border border-border bg-card/50 p-5">
            <h3 className="text-sm font-semibold">Bring your own endpoint</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The RPC URLs above are the Stellar Development Foundation&apos;s public endpoints, and
              they are only defaults. Every SDK entry point accepts{' '}
              <code className="font-mono text-foreground">rpcUrl</code> and{' '}
              <code className="font-mono text-foreground">registryContractId</code> overrides, so
              you can point resolution at your own node.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---- Quickstart ------------------------------------------------ */}
      <section id="resolve" className="border-t border-border bg-foreground/2">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Quickstart</p>
            <h2 className="font-display mt-4 text-4xl sm:text-5xl">Three ways to resolve a DID.</h2>
            <p className="mt-4 text-muted-foreground">
              All three return the same DID Document. Two of them never touch ACTA infrastructure.
            </p>
          </Reveal>

          <Stagger className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-3">
            {PATHS.map((path) => (
              <StaggerItem
                key={path.title}
                className="flex flex-col gap-3 bg-background p-5 transition-colors duration-300 hover:bg-foreground/2"
              >
                <h3 className="font-mono text-xs uppercase tracking-widest text-primary">
                  {path.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{path.body}</p>
                <code className="mt-auto block whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-foreground/85">
                  {path.code}
                </code>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---- Trust model ----------------------------------------------- */}
      <section id="trust" className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Trust model</p>
            <h2 className="font-display mt-4 text-4xl sm:text-5xl">You do not have to trust us.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              If every server ACTA operates disappeared tonight, every did:stellar would still
              resolve tomorrow.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <Stagger as="ul" className="flex flex-col gap-3">
              {GUARANTEES.map((item) => (
                <StaggerItem
                  as="li"
                  key={item.claim}
                  className="rounded-xl border border-border bg-card/50 p-5 transition-colors duration-300 hover:border-primary/30"
                >
                  <h3 className="text-sm font-semibold">{item.claim}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </StaggerItem>
              ))}
            </Stagger>

            <Reveal>
              <h3 className="text-sm font-semibold">What you still depend on</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Trust-minimized is not trust-free, and a method that pretends otherwise is not worth
                adopting.
              </p>

              <ul className="mt-5 flex flex-col gap-3">
                {DEPENDENCIES.map((item) => (
                  <li
                    key={item.title}
                    className="border-l border-border pl-4 transition-colors duration-300 hover:border-primary/50"
                  >
                    <h4 className="text-sm font-medium">{item.title}</h4>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---- Where the detail lives ------------------------------------ */}
      <section className="border-t border-border bg-foreground/2">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
          <Reveal className="max-w-2xl">
            <h2 className="font-display text-4xl sm:text-5xl">The rest is documentation.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Contract operations, record limits, resolution states, error codes, the HTTP API and
              the TypeScript library all live in the ACTA docs, next to the normative specification.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={SITE.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: 'lg' })}
              >
                Read the docs
                <ArrowUpRight />
              </a>
              <a
                href={SITE.specUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                v0.1 specification
              </a>
              <a
                href={SITE.npmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                @acta-team/did-stellar
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
