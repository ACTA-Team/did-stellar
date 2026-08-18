'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import * as React from 'react';

import { buttonVariants } from '@/components/ui/button';
import { GithubIcon } from '@/components/icons';
import { NAV_LINKS, SITE } from '@/lib/site';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/85 backdrop-blur-md">
      <nav className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="did:stellar, home" className="flex items-center rounded-md">
          <Image
            src="/stellar-lockup.png"
            alt="Stellar"
            width={377}
            height={96}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const className =
              'rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground';

            return link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(className, 'inline-flex items-center gap-1')}
              >
                {link.label}
                <ArrowUpRight className="size-3.5" />
              </a>
            ) : (
              // A plain anchor, not Link: these are fragments of the page
              // already on screen, and the router would turn the glide
              // into a jump.
              <a key={link.href} href={link.href} className={className}>
                {link.label}
              </a>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <a
            href={SITE.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <GithubIcon />
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle navigation"
            aria-expanded={open}
            className="ml-1 inline-flex size-9 items-center justify-center rounded-full text-foreground/80 hover:bg-foreground/6 md:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-5 py-2 sm:px-8">
            {NAV_LINKS.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                  <ArrowUpRight className="size-3.5" />
                </a>
              ) : (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                </a>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
}
