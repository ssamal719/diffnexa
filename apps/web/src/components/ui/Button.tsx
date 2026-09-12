import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-signal text-white border-signal hover:bg-[#0e4467] disabled:bg-rule-strong disabled:border-rule-strong",
  secondary: "bg-paper text-ink border-rule-strong hover:bg-surface",
  quiet: "bg-transparent text-signal border-transparent underline underline-offset-2 hover:bg-signal-soft",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({ variant = "primary", className = "", children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-[3px] border px-4 py-2",
        "text-[0.95rem] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:text-white",
        VARIANTS[variant],
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
