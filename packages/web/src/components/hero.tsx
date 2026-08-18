import { ArrowDown, ArrowUpRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Credits } from '@/components/credits';
import { Enter } from '@/components/motion/reveal';
import { buttonVariants } from '@/components/ui/button';
import { SITE } from '@/lib/site';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div aria-hidden="true" className="bg-dots absolute inset-0" />

      <div className="relative mx-auto w-full max-w-7xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        {/* Staggered so the eye lands on the headline first, then the
            claim, then the console that backs it up. */}
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Enter className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="accent" className="font-mono">
              did:stellar v0.1
            </Badge>
            <Badge variant="outline" className="font-mono">
              by ACTA
            </Badge>
          </Enter>

          <Enter
            as="h1"
            delay={0.08}
            className="font-display mt-7 text-balance text-5xl leading-[1.04] sm:text-6xl md:text-7xl"
          >
            Decentralized identity,
            <br />
            anchored on Stellar.
          </Enter>

          <Enter
            as="p"
            delay={0.16}
            className="mt-5 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            A W3C-compliant DID method backed by a Soroban registry contract, designed and built by{' '}
            <a
              href={SITE.actaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-ring/60 underline-offset-4 hover:decoration-ring"
            >
              ACTA
            </a>
            . Anyone can resolve a <span className="font-mono text-foreground">did:stellar</span>{' '}
            with nothing but a Stellar RPC endpoint, no hosted service required.
          </Enter>

          <Enter delay={0.24} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#anatomy" className={buttonVariants({ size: 'lg', className: 'pr-2' })}>
              Take it apart
              <span className="flex size-8 items-center justify-center rounded-full bg-fill text-[#07090f]">
                <ArrowDown className="size-4" />
              </span>
            </a>
            <a
              href={SITE.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              Read the docs
              <ArrowUpRight />
            </a>
          </Enter>

          {/* Last in the entrance sequence: the eye reaches the credits
              after it has read the claim and seen the way in. */}
          <Enter delay={0.34}>
            <Credits className="mt-14" />
          </Enter>
        </div>
      </div>
    </section>
  );
}
