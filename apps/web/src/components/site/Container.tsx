import type { ReactNode } from "react";

/**
 * The page width every part of the site lines up to: header, page text,
 * upload panels and footer. 80rem (1280px) on a desktop, with 16px of margin
 * on a phone. Comparison workspaces may be wider; everything else is not.
 */
export function Container({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "header" | "footer" | "nav";
}) {
  return <Tag className={`mx-auto w-full max-w-[80rem] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</Tag>;
}
