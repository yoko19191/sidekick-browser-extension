/** shadcn/ui-style primitives (copied-in components on design tokens; Radix for popover & dropdown). */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { createContext, forwardRef, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { tr } from "@/src/i18n";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export const cx = cn;

// ---------- Button ----------
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-btn font-medium transition-[color,background,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-card-strong text-foreground hover:bg-muted",
        outline: "border border-border bg-background text-foreground hover:bg-card",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        soft: "bg-primary-soft text-primary-soft-foreground hover:brightness-95",
        destructive: "text-destructive hover:bg-destructive/10",
      },
      size: { default: "h-9 px-3.5 text-[13.5px]", sm: "h-8 px-3 text-[12.5px]", lg: "h-10 px-4 text-[14px]", icon: "size-8" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; icon?: LucideIcon; testId?: string };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ className, variant, size, asChild, icon: Icon, testId, children, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp ref={ref} type="button" data-testid={testId} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {Icon && <Icon strokeWidth={2} />}
      {children}
    </Comp>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, { icon: LucideIcon; label: string; active?: boolean; testId?: string; className?: string; onClick?: () => void } & ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ icon: Icon, label, active, testId, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      data-active={active ? "" : undefined}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-btn outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className="size-[18px]" strokeWidth={1.8} />
    </button>
  ),
);

// ---------- surfaces ----------
export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card bg-card", className)} {...rest}>{children}</div>;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-1 pb-2 pt-5 text-[12px] font-medium text-muted-foreground", className)}>{children}</div>;
}

export function Row({ icon: Icon, title, subtitle, right, onClick, chevron = !!onClick, testId, danger, className }: {
  icon?: LucideIcon; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onClick?: () => void; chevron?: boolean; testId?: string; danger?: boolean; className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} data-testid={testId}
      className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", onClick && "transition-colors hover:bg-card-strong/60", className)}>
      {Icon && <Icon className={cn("size-[18px] shrink-0", danger ? "text-destructive" : "text-muted-foreground")} strokeWidth={1.8} />}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[14px] font-medium", danger && "text-destructive")}>{title}</div>
        {subtitle && <div className="mt-0.5 text-[12px] leading-[18px] text-muted-foreground">{subtitle}</div>}
      </div>
      {right}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </Comp>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("divide-y divide-border/70 overflow-hidden", className)}>{children}</Card>;
}

// ---------- form controls ----------
export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label?: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} onClick={() => onChange(!checked)}
      className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", checked ? "bg-primary" : "bg-input")}>
      <span className={cn("absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all", checked ? "left-[19px]" : "left-[3px]")} />
    </button>
  );
}
export const Toggle = Switch;

export function Segmented<T extends string>({ value, options, onChange, testId, className }: { value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; testId?: string; className?: string }) {
  return (
    <div className={cn("flex rounded-btn bg-muted p-0.5", className)} data-testid={testId} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} data-value={o.value}
          className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12.5px] font-medium transition-all",
            value === o.value ? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-muted-foreground hover:text-foreground")}>
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, testId, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; testId?: string; className?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <div className={cn("relative", className)}>
      <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none truncate rounded-sm border border-input bg-background pl-2.5 pr-8 text-[13px] text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring">
        {groups.map((g) =>
          g ? (
            <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
          ) : (
            options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          ),
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export const inputCls = "w-full rounded-card border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-ring";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted-foreground"><span>{label}</span>{hint}</div>
      {children}
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, type = "text", mono, testId, hint, right, className }: {
  label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean; testId?: string; hint?: ReactNode; right?: ReactNode; className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="flex items-center gap-2">
        <input data-testid={testId} type={type} value={value} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} className={cn(inputCls, mono && "font-mono text-[12.5px]")} />
        {right}
      </div>
    </Field>
  );
}

/** Level-3 options: collapsed by default and labelled "高级". */
export function Advanced({ title = tr("common.advanced"), children, testId, defaultOpen = false }: { title?: string; children: ReactNode; testId?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3 rounded-card bg-card" data-testid={testId} data-open={open ? "" : undefined}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium" aria-expanded={open}>
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="flex-1">{title}</span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">{tr("common.advanced")}</span>
      </button>
      {open && <div className="animate-in border-t border-border/70 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

// ---------- floating layers (the only things with a shadow) ----------
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ children, className, align = "end", testId }: { children: ReactNode; className?: string; align?: "start" | "center" | "end"; testId?: string }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6} collisionPadding={8} data-testid={testId}
        className={cn("z-50 w-72 animate-in rounded-card border border-border/60 bg-popover p-3 text-foreground shadow-float outline-none", className)}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;
export function DropdownContent({ children, className, align = "start", testId }: { children: ReactNode; className?: string; align?: "start" | "end"; testId?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} collisionPadding={8} data-testid={testId}
        className={cn("z-50 max-h-[60vh] min-w-56 animate-in overflow-y-auto rounded-card border border-border/60 bg-popover p-1.5 text-foreground shadow-float outline-none", className)}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}
export function DropdownLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-muted-foreground">{children}</DropdownPrimitive.Label>;
}
export function DropdownItem({ children, onSelect, checked, testId, icon: Icon }: { children: ReactNode; onSelect?: () => void; checked?: boolean; testId?: string; icon?: LucideIcon }) {
  return (
    <DropdownPrimitive.Item onSelect={onSelect} data-testid={testId}
      className="flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-muted">
      {Icon && <Icon className="size-4 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check className="size-4 text-primary" strokeWidth={2.4} />}
    </DropdownPrimitive.Item>
  );
}
export const DropdownSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-border/70" />;

// ---------- toast (top, 3s auto-dismiss; severe errors stay with details) ----------
interface ToastItem { id: number; text: string; tone: "info" | "error"; detail?: string; sticky?: boolean }
const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { ...t, id }]);
    if (!t.sticky) setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3">
        {items.map((t) => (
          <div key={t.id} data-testid="toast" className={cn("pointer-events-auto max-w-full animate-in rounded-btn border px-3 py-2 text-[12.5px] shadow-float",
            t.tone === "error" ? "border-destructive/30 bg-popover text-destructive" : "border-border/60 bg-popover text-foreground")}>
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-words">{t.text}</span>
              {t.sticky && <button className="text-muted-foreground hover:text-foreground" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>✕</button>}
            </div>
            {t.detail && <details className="mt-1 text-[11.5px] text-muted-foreground"><summary className="cursor-pointer">{tr("common.details")}</summary><div className="mt-1 break-all">{t.detail}</div></details>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
