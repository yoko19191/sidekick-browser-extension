export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="pp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d6af7" />
          <stop offset="1" stopColor="#a35cf0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#pp-g)" />
      <path d="M9 22.5V9.5h7.2a4.6 4.6 0 0 1 0 9.2H12.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.6" cy="22.4" r="2.1" fill="#fff" opacity=".9" />
    </svg>
  );
}
