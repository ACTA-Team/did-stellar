import Image from 'next/image';

import { SITE } from '@/lib/site';

const COLUMNS: ReadonlyArray<{
  title: string;
  links: ReadonlyArray<{ label: string; href: string; external?: boolean }>;
}> = [
  {
    title: 'Method',
    links: [
      { label: 'Syntax', href: '/#anatomy' },
      { label: 'Registry', href: '/#registry' },
      { label: 'Resolve a DID', href: '/#resolve' },
      { label: 'Trust model', href: '/#trust' },
      { label: 'v0.1 specification', href: SITE.specUrl, external: true },
    ],
  },
  {
    title: 'Reference',
    links: [
      { label: 'Documentation', href: SITE.docsUrl, external: true },
      { label: 'Swagger UI', href: SITE.swaggerUrl, external: true },
      { label: 'OpenAPI spec', href: SITE.openApiUrl, external: true },
      { label: 'npm package', href: SITE.npmUrl, external: true },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'GitHub', href: SITE.repoUrl, external: true },
      {
        label: 'DIF Universal Resolver',
        href: SITE.universalResolverUrl,
        external: true,
      },
      { label: 'ACTA', href: SITE.actaUrl, external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            {/* Same mark as the header, so the page opens and closes on the
                same signature -- but quieter here, and sharing the h-6 band
                with the column titles so all four columns start on one line. */}
            <div className="flex h-6 items-center">
              <Image
                src="/stellar-lockup.png"
                alt="Stellar"
                width={377}
                height={96}
                className="h-5 w-auto"
              />
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              A W3C Decentralized Identifier anchored in a Soroban registry contract.
              Trust-minimized by design.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <span className="flex h-6 items-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {column.title}
              </span>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Apache-2.0. Built by{' '}
            <a
              href={SITE.actaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-ring/60 underline-offset-4 hover:decoration-ring"
            >
              ACTA
            </a>
            .
          </p>
          <p className="font-mono">did:stellar v0.1</p>
        </div>
      </div>
    </footer>
  );
}
