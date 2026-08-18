import Image from 'next/image';

import { SITE } from '@/lib/site';

/**
 * Attribution marks, stated once under the hero the way acta.build
 * states its own: a quiet line the eye reaches after the headline and
 * the buttons, never chrome competing with the nav.
 *
 * Both logos are black ink on transparency, so they sit straight on the
 * sheet with no disc behind them. They ride at 80% until hover, so the
 * credits stay quieter than the buttons above them.
 */
function Credit({
  prefix,
  href,
  children,
}: {
  prefix: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2.5"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors group-hover:text-foreground/70">
        {prefix}
      </span>
      {children}
    </a>
  );
}

export function Credits({ className }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-7 ${
        className ?? ''
      }`}
    >
      {/* The ACTA mark has no wordmark of its own, so the name is set
          in type beside it. */}
      <Credit prefix="Built by" href={SITE.actaUrl}>
        <Image
          src="/acta-mark.png"
          alt=""
          width={177}
          height={160}
          className="h-5 w-auto opacity-80 transition-opacity group-hover:opacity-100"
        />
        <span className="text-sm font-medium tracking-tight text-foreground/85 transition-colors group-hover:text-foreground">
          ACTA
        </span>
      </Credit>

      <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />

      {/* The Stellar lockup carries its own wordmark: setting the name
          again beside it would say Stellar twice. */}
      <Credit prefix="Powered by" href={SITE.stellarUrl}>
        <Image
          src="/stellar-lockup.png"
          alt="Stellar"
          width={377}
          height={96}
          className="h-5 w-auto opacity-80 transition-opacity group-hover:opacity-100"
        />
      </Credit>
    </div>
  );
}
