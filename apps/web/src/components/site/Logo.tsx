/**
 * The DiffNexa mark: two documents side by side, the right one marked as
 * changed — the same drawing as the site icon, in the existing brand colours.
 */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="6" fill="#14202c" />
      <rect x="6" y="7" width="8.5" height="18" rx="1.5" fill="#ffffff" opacity="0.55" />
      <rect x="17.5" y="7" width="8.5" height="18" rx="1.5" fill="#ffffff" />
      <rect x="19.5" y="11" width="4.5" height="1.8" rx="0.9" fill="#12557f" />
      <rect x="19.5" y="15" width="4.5" height="1.8" rx="0.9" fill="#1b6b3a" />
      <rect x="19.5" y="19" width="2.6" height="1.8" rx="0.9" fill="#a4262c" />
    </svg>
  );
}
