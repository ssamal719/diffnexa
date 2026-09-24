import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The building blocks of the written sections on tool and information pages,
 * so every page's headings, spacing and questions look and read the same.
 * The words are each page's own.
 */

/** One H2 section. */
export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mt-12 scroll-mt-6" aria-labelledby={id}>
      <h2 id={id} className="text-[1.35rem] font-semibold tracking-tight">
        {title}
      </h2>
      {lead && <div className="mt-2 max-w-[70ch] space-y-2 text-[0.98rem] leading-relaxed text-ink-soft">{lead}</div>}
      {children}
    </section>
  );
}

/** Paragraphs of explanation at a readable width. */
export function Paragraphs({ children }: { children: ReactNode }) {
  return <div className="mt-3 max-w-[70ch] space-y-3 text-[0.98rem] leading-relaxed">{children}</div>;
}

/** Numbered steps, as cards. */
export function StepCards({ steps }: { steps: { title: string; detail: ReactNode }[] }) {
  return (
    <ol className={`mt-4 grid gap-3 md:grid-cols-2 ${steps.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
          <span className="tabular text-[0.8rem] font-semibold text-ink-soft">Step {index + 1}</span>
          <h3 className="mt-1 font-medium">{step.title}</h3>
          <p className="mt-1 text-[0.9rem] text-ink-soft">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

/** Titled cards, each a short explanation. */
export function DetailCards({ items }: { items: { title: string; detail: ReactNode }[] }) {
  return (
    <dl className="mt-4 grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
          <dt className="font-medium">{item.title}</dt>
          <dd className="mt-1 text-[0.9rem] text-ink-soft">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain bulleted list. */
export function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 max-w-[70ch] list-disc space-y-2 pl-5 text-[0.98rem] leading-relaxed text-ink-soft marker:text-rule-strong">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Questions and their answers. */
export function FaqList({ items }: { items: { question: string; answer: ReactNode }[] }) {
  return (
    <dl className="mt-4 max-w-[70ch] divide-y divide-rule rounded-[var(--radius-panel)] border border-rule bg-paper">
      {items.map((item) => (
        <div key={item.question} className="p-4">
          <dt className="font-medium">{item.question}</dt>
          <dd className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The optional AI step, as it applies to one tool, with a link to the full explanation. */
export function AiStep({ children }: { children: ReactNode }) {
  return (
    <Section id="ai-change-analyst" title="Optional: AI Change Analyst">
      <div className="mt-3 max-w-[70ch] rounded-[var(--radius-panel)] border border-dashed border-rule-strong bg-paper p-4 text-[0.95rem] leading-relaxed">
        {children}
        <p className="mt-2">
          <Link href="/ai-change-analyst" className="font-medium text-signal hover:underline">
            How AI Change Analyst works
          </Link>
        </p>
      </div>
    </Section>
  );
}

/** A link inside running text, styled as one. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-signal underline underline-offset-2 hover:text-[#0e4467]">
      {children}
    </Link>
  );
}
