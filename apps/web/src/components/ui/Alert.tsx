import type { ReactNode } from "react";

type Tone = "problem" | "note" | "planned";

/**
 * Every alert states its kind in words as well as colour, so the meaning
 * survives greyscale printing, colour blindness and screen readers.
 */
const TONES: Record<Tone, { label: string; border: string; background: string; text: string }> = {
  problem: { label: "Problem", border: "border-removed", background: "bg-[#fdf0f0]", text: "text-removed" },
  note: { label: "Note", border: "border-rule-strong", background: "bg-surface", text: "text-ink-soft" },
  planned: { label: "Planned", border: "border-caution", background: "bg-caution-soft", text: "text-caution" },
};

export function Alert({
  tone = "note",
  title,
  children,
  role = "status",
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const style = TONES[tone];
  return (
    <div
      role={role}
      className={`border-l-2 ${style.border} ${style.background} px-3 py-2 text-[0.9rem]`}
    >
      <p className={`font-semibold ${style.text}`}>{title ?? style.label}</p>
      <div className="text-ink">{children}</div>
    </div>
  );
}
