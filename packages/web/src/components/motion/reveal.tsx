'use client';

import * as React from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';

/**
 * Motion vocabulary for the whole site. The brand manual asks for
 * clarity over decoration, so the rules are deliberately narrow:
 * short durations, small offsets, one direction (up), and every
 * entrance plays once. Nothing loops, nothing bounces on content.
 */
const EASE = [0.16, 1, 0.3, 1] as const;

const DISTANCE = 16;

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: DISTANCE },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
};

/** Entrance for a block that appears when scrolled into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'div',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'header';
  id?: string;
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return (
      <Plain className={className} id={id}>
        {children}
      </Plain>
    );
  }

  return (
    <Component
      id={id}
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -8% 0px' }}
      variants={revealVariants}
      transition={{ delay }}
    >
      {children}
    </Component>
  );
}

/**
 * Parent for a row or grid of items that should arrive one after the
 * other rather than all at once. Pair with {@link StaggerItem}.
 */
export function Stagger({
  children,
  className,
  gap = 0.08,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
  as?: 'div' | 'section' | 'ul';
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1, margin: '0px 0px -8% 0px' }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: gap } },
      }}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'li';
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component className={className} variants={revealVariants}>
      {children}
    </Component>
  );
}

/**
 * Entrance for content that is already on screen at load time, such as
 * the hero. Uses `animate` instead of `whileInView` so it does not wait
 * for a scroll that may never happen.
 */
export function Enter({
  children,
  className,
  delay = 0,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'p' | 'h1';
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: DISTANCE }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </Component>
  );
}
