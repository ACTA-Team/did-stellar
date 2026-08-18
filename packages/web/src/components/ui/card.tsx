import * as React from 'react';

import { cn } from '@/lib/utils';

/** Brand manual §11. Standard card: header + content + footer. */
function Card({
  className,
  featured = false,
  ...props
}: React.ComponentProps<'div'> & { featured?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-xl border bg-card/60 text-card-foreground',
        'shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_5%,transparent)_inset,0_12px_40px_-12px_rgba(0,0,0,0.35)]',
        featured ? 'border-primary/30' : 'border-border',
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

function CardEyebrow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('font-mono text-xs uppercase tracking-widest text-primary', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export { Card, CardHeader, CardEyebrow, CardTitle, CardDescription, CardContent };
