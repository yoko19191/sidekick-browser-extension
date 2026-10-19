import { tr } from "@/src/i18n";
/** 翻翻 Sidekick mark: an original line over its (fainter) translations, plus a small AI spark. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label={tr("brand.header")} role="img" className="shrink-0">
      <defs>
        <linearGradient id="sk-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#sk-g)" />
      <rect x="7" y="9" width="18" height="3.2" rx="1.6" fill="#fff" />
      <rect x="7" y="15" width="12" height="3.2" rx="1.6" fill="#fff" opacity=".55" />
      <path d="M23.2 18.4l1.05 2.35 2.35 1.05-2.35 1.05-1.05 2.35-1.05-2.35-2.35-1.05 2.35-1.05z" fill="#fff" />
      <rect x="7" y="21" width="9" height="3.2" rx="1.6" fill="#fff" opacity=".55" />
    </svg>
  );
}
