"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
};

/**
 * A labelled text input.
 *
 * Shared rather than local to one tool: the label is always present (never a
 * placeholder standing in for one), the hint and error are tied to the input by
 * id so screen readers announce them, and an error is marked with a word as
 * well as colour.
 */
export function TextField({ label, hint, error, className = "", ...rest }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[0.9rem] font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-[0.82rem] text-ink-soft">
          {hint}
        </p>
      )}
      <input
        {...rest}
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={[
          "mt-1.5 w-full rounded-[3px] border bg-paper px-3 py-2 text-[0.95rem]",
          "placeholder:text-rule-strong",
          error ? "border-removed" : "border-rule-strong",
        ].join(" ")}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[0.85rem] text-removed">
          <span className="font-semibold">Problem: </span>
          {error}
        </p>
      )}
    </div>
  );
}
