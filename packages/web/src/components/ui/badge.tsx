import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Brand manual §12. Status chips whose semantic colours map onto
 * resolution outcomes: success = 200, warning = 410 tombstone,
 * error = 400/404, info = neutral metadata.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-foreground/4 text-foreground/80',
        accent: 'border-primary/30 bg-primary/10 text-primary',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-primary/30 bg-primary/10 text-primary',
        error: 'border-destructive/30 bg-destructive/10 text-destructive',
        info: 'border-info/30 bg-info/10 text-info',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Dot-prefixed status chip, as drawn in the manual (●Valid ●Revoked). */
function StatusBadge({
  children,
  variant,
  className,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <Badge variant={variant} className={className} {...props}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-80" />
      {children}
    </Badge>
  );
}

export { Badge, StatusBadge, badgeVariants };
