"use client";

import { useId, type SelectHTMLAttributes } from "react";

type Option = { id: string; label: string };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> & {
  label: string;
  hint?: string;
  options: readonly Option[];
};

/**
 * A labelled dropdown.
 *
 * A native select, so it works with a keyboard, a screen reader and a phone's
 * own picker without any of that being reimplemented.
 */
export function Select({ label, hint, options, className = "", ...rest }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;

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
      <select
        {...rest}
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className="mt-1.5 w-full rounded-[3px] border border-rule-strong bg-paper px-3 py-2 text-[0.95rem]"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
