import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius-panel)] border border-rule bg-paper ${className}`}>
      {children}
    </div>
  );
}
