import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';

/**
 * The identifier taken apart. This is the first thing the page shows
 * after the headline because the string itself is the whole argument:
 * three fixed segments and one that carries 128 bits of entropy.
 *
 * The plate holds the specimen (tokens, rules, labels); the grid below
 * holds the prose. Splitting them keeps the notes readable without
 * forcing a three-character column to be as wide as its sentence.
 */
const SEGMENTS = [
  {
    token: 'did',
    label: 'Scheme',
    note: 'Fixed. Every W3C Decentralized Identifier opens with it.',
    tone: 'muted',
  },
  {
    token: 'stellar',
    label: 'Method',
    note: 'Registered in the W3C DID Extensions registry as the stellar method.',
    tone: 'accent',
  },
  {
    token: 'testnet',
    label: 'Network',
    note: 'mainnet or testnet. A closed set, with no aliases and no default.',
    tone: 'muted',
  },
  {
    token: 'znfxngsh46vkyqu6inrx4omphi',
    label: 'Identifier',
    note: '16 random bytes as lowercase base32: 26 characters of [a-z2-7].',
    tone: 'solid',
  },
] as const;

const TOKEN_TONE = {
  muted: 'text-muted-foreground',
  accent: 'text-primary',
  solid: 'text-foreground',
} as const;

const RULE_TONE = {
  muted: 'bg-muted-foreground/25',
  accent: 'bg-primary/60',
  solid: 'bg-primary',
} as const;

const LABEL_TONE = {
  muted: 'text-muted-foreground',
  accent: 'text-primary',
  solid: 'text-foreground',
} as const;

export function DidAnatomy() {
  return (
    <section id="anatomy" className="border-b border-border bg-foreground/2">
      <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Syntax</p>
          <h2 className="font-display mt-4 text-4xl sm:text-5xl">
            Four segments. One of them is random.
          </h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Everything before the last colon is fixed vocabulary. Everything after it is entropy,
            generated on your machine and never derived from a Stellar account.
          </p>
        </Reveal>

        {/* The specimen. Scrolls horizontally rather than wrapping: a DID
            broken across two lines stops being a single identifier. */}
        <Reveal
          delay={0.08}
          className="mt-10 overflow-hidden rounded-2xl border border-console-border bg-console"
        >
          {/* The segments arrive left to right, in reading order: the
              string assembles itself before the labels explain it. */}
          <div className="overflow-x-auto px-5 py-8 sm:px-8 sm:py-10">
            <Stagger gap={0.1} className="flex min-w-max items-start justify-center gap-1">
              {SEGMENTS.map((segment, index) => (
                <StaggerItem key={segment.token} className="flex items-start gap-1">
                  <div className="flex flex-col items-center">
                    <span
                      className={`font-mono text-base leading-none tracking-tight sm:text-2xl ${
                        TOKEN_TONE[segment.tone]
                      }`}
                    >
                      {segment.token}
                    </span>

                    {/* Connector: a drop line into a rule the exact width of
                        the segment it measures. */}
                    <span
                      aria-hidden="true"
                      className={`mt-3 h-3 w-px ${RULE_TONE[segment.tone]}`}
                    />
                    <span aria-hidden="true" className={`h-px w-full ${RULE_TONE[segment.tone]}`} />

                    <span
                      className={`mt-2.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
                        LABEL_TONE[segment.tone]
                      }`}
                    >
                      {segment.label}
                    </span>
                  </div>

                  {index < SEGMENTS.length - 1 && (
                    <span className="font-mono text-base leading-none text-muted-foreground sm:text-2xl">
                      :
                    </span>
                  )}
                </StaggerItem>
              ))}
            </Stagger>
          </div>

          <div className="flex flex-col gap-1 border-t border-console-border px-5 py-4 sm:flex-row sm:items-baseline sm:gap-4 sm:px-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Validation
            </span>
            <code className="break-all font-mono text-xs text-foreground/85">
              ^did:stellar:(mainnet|testnet):[a-z2-7]&#123;26&#125;$
            </code>
          </div>
        </Reveal>

        <Stagger className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((segment) => (
            <StaggerItem
              key={segment.token}
              className="bg-background p-5 transition-colors duration-300 hover:bg-foreground/2"
            >
              <p
                className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
                  LABEL_TONE[segment.tone]
                }`}
              >
                {segment.label}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{segment.note}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
