/** The app mark, same drawing as `src/app/icon.svg`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#7c3aed" />
      <path d="M18 8h20l12 12v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff" />
      <path d="M38 8v8a4 4 0 0 0 4 4h8z" fill="#c4b5fd" />
      <path d="M27 29l-7 8 7 8m10-16l7 8-7 8" fill="none" stroke="#7c3aed" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
