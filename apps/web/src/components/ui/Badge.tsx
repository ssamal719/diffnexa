import type { ReactNode } from "react";

type Tone = "neutral" | "ready" | "working" | "planned";

const TONES: Record<Tone, string> = {
  neutral: "border-rule-strong text-ink-soft bg-paper",
  ready: "border-added text-added bg-[#f1f7f3]",
  working: "border-signal text-signal bg-signal-soft",
  planned: "border-caution text-caution bg-caution-soft",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[0.75rem] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
