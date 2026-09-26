import type { ExampleGuideText } from "@/lib/examples";

/**
 * How a tool works, told through its built-in example.
 *
 * Shown above the result whenever the result came from "Try example", so the
 * reader knows the files are examples, what the tool did with them, and what
 * was changed between the two versions — then the result below shows how
 * DiffNexa found it.
 */
export function ExampleGuide({ guide }: { guide: ExampleGuideText }) {
  return (
    <section
      aria-labelledby="example-guide-heading"
      className="mt-6 rounded-[var(--radius-panel)] border border-signal/40 bg-signal-soft/60 p-4 md:p-5"
    >
      <p className="text-[0.78rem] font-semibold tracking-wide text-signal uppercase">How this tool works</p>
      <h2 id="example-guide-heading" className="mt-1 text-[1.1rem] font-semibold">
        {guide.title}
      </h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ol className="space-y-2">
          {guide.steps.map((step, index) => (
            <li key={step} className="flex gap-2.5 text-[0.9rem]">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal text-[0.78rem] font-semibold text-white"
              >
                {index + 1}
              </span>
              <span>
                <span className="sr-only">Step {index + 1}: </span>
                {step}
              </span>
            </li>
          ))}
        </ol>
        <div className="rounded-[6px] border border-rule bg-paper p-3">
          <h3 className="text-[0.9rem] font-semibold">What was changed in this example</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.85rem]">
            {guide.changed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-[0.8rem] text-ink-soft">
            The results below come from DiffNexa&apos;s own comparison of the two versions.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[0.85rem] font-medium">{guide.next}</p>
    </section>
  );
}
