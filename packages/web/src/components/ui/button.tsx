import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Brand manual §09, one primary action per screen. The primary is an
 * ink pill rather than a gold one: on the light sheet, gold at button
 * size is a field of colour competing with the dot matrix, so gold
 * stays a fill for small marks and the button carries the weight.
 *
 * Pill radius and the h-10/h-12 scale are brand decisions, so this file
 * deliberately diverges from stock shadcn. If the shadcn CLI overwrites
 * it again while adding a component, restore this version.
 *
 * No Radix `Slot` here on purpose: it calls createContext at module
 * scope, which the RSC React runtime does not provide, so importing it
 * would make this unusable from server components. Links that need to
 * look like buttons use `buttonVariants` directly.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium outline-none transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-foreground text-background shadow-sm hover:bg-foreground/88',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-border bg-foreground/2 text-foreground hover:bg-foreground/6',
        ghost: 'text-foreground/80 hover:bg-foreground/6 hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-foreground underline decoration-ring/60 underline-offset-4 hover:decoration-ring',
      },
      size: {
        default: 'h-10 px-5',
        sm: 'h-9 px-4',
        lg: 'h-12 px-7 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
