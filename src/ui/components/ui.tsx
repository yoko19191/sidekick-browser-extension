import { Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function IconButton({ icon: Icon, label, onClick, active, className, testId }: { icon: LucideIcon; label: string; onClick?: () => void; active?: boolean; className?: string; testId?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className={cx(
        "grid size-8 place-items-center rounded-xl transition-colors",
        active ? "bg-accent-soft text-accent dark:bg-accent/20 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 hover:text-ink dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-white",
        className,
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.8} />
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-soft dark:border-white/[0.06] dark:bg-[#1a1a1f]", className)}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-1.5 pt-4 text-[12px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">{children}</div>;
}

export function IconTile({ icon: Icon, tone = "zinc" }: { icon: LucideIcon; tone?: "indigo" | "emerald" | "amber" | "sky" | "rose" | "violet" | "zinc" }) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-white/8 dark:text-zinc-300",
  };
  return (
    <span className={cx("grid size-8 shrink-0 place-items-center rounded-[10px]", tones[tone])}>
      <Icon className="size-[17px]" strokeWidth={1.9} />
    </span>
  );
}

export function Row({ icon, tone, title, subtitle, right, onClick, chevron = !!onClick, testId, danger }: {
  icon?: LucideIcon; tone?: Parameters<typeof IconTile>[0]["tone"]; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onClick?: () => void; chevron?: boolean; testId?: string; danger?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cx("flex w-full items-center gap-3 px-3.5 py-3 text-left", onClick && "transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-white/[0.03] dark:active:bg-white/[0.05]")}
    >
      {icon && <IconTile icon={icon} tone={tone} />}
      <div className="min-w-0 flex-1">
        <div className={cx("truncate text-[14px] font-medium", danger ? "text-rose-600 dark:text-rose-400" : "text-ink dark:text-zinc-100")}>{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400">{subtitle}</div>}
      </div>
      {right}
      {chevron && <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" />}
    </Comp>
  );
}

export function Divider() {
  return <div className="ml-14 h-px bg-zinc-100 dark:bg-white/[0.05]" />;
}

export function Group({ children }: { children: ReactNode[] | ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <Card>
      {items.map((c, i) => (
        <div key={i}>
          {i > 0 && <Divider />}
          {c}
        </div>
      ))}
    </Card>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-zinc-200 dark:bg-zinc-700")}
    >
      <span className={cx("absolute top-[3px] size-4 rounded-full bg-white shadow transition-all", checked ? "left-[19px]" : "left-[3px]")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-zinc-100 p-0.5 dark:bg-white/[0.06]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-medium transition-all",
            value === o.value ? "bg-white text-ink shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-ink dark:text-zinc-400 dark:hover:text-white",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, testId }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; testId?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <div className="relative">
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-[190px] appearance-none truncate rounded-xl border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-[13px] text-ink outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100"
      >
        {groups.map((g) =>
          g ? (
            <optgroup key={g} label={g}>
              {options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ) : (
            options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          ),
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder, type = "text", mono, testId, hint, right }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean; testId?: string; hint?: ReactNode; right?: ReactNode;
}) {
  return (
    <label className="block px-3.5 py-3">
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        {hint}
      </div>
      <div className="flex items-center gap-2">
        <input
          data-testid={testId}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={cx("min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-zinc-400 focus:border-accent/60 focus:bg-white focus:ring-2 focus:ring-accent/15 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-100 dark:focus:bg-white/[0.05]", mono && "font-mono text-[12.5px]")}
        />
        {right}
      </div>
    </label>
  );
}

export function Button({ children, onClick, variant = "primary", icon: Icon, disabled, className, testId, size = "md" }: {
  children?: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: LucideIcon; disabled?: boolean; className?: string; testId?: string; size?: "sm" | "md";
}) {
  const v = {
    primary: "bg-ink text-white hover:bg-zinc-800 dark:bg-white dark:text-ink dark:hover:bg-zinc-200 shadow-sm",
    secondary: "border border-zinc-200 bg-white text-ink hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]",
    ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/8",
    danger: "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10",
  }[variant];
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50", size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-[13.5px]", v, className)}
    >
      {Icon && <Icon className="size-4" strokeWidth={2} />}
      {children}
    </button>
  );
}

export function CheckMark({ on }: { on: boolean }) {
  return on ? <Check className="size-4 text-accent" strokeWidth={2.4} /> : <span className="size-4" />;
}
