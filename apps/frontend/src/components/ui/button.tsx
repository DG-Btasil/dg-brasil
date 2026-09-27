import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy-800 active:bg-navy-950 shadow-hairline",
  accent: "bg-gold text-navy hover:bg-gold-600 hover:text-white active:bg-gold-600 shadow-hairline",
  secondary: "bg-surface text-foreground border border-line-strong hover:bg-surface-muted hover:border-navy-600/40",
  ghost: "text-muted hover:text-foreground hover:bg-surface-sunken",
  danger: "bg-surface text-danger border border-danger-line hover:bg-danger-soft",
  link: "text-navy-700 underline-offset-4 hover:underline px-0 h-auto",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12.5px] rounded-md",
  md: "h-9 px-3.5 text-[13px] rounded-md",
  lg: "h-10 px-4 text-[14px] rounded-md",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], variant !== "link" && sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant = "primary", size = "md", icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: "ghost" | "secondary" | "onDark";
  size?: "sm" | "md";
}

/** Botão só com ícone. `label` é obrigatório (aria-label + title). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50",
        size === "sm" ? "size-8" : "size-9",
        variant === "ghost" && "text-muted hover:text-foreground hover:bg-surface-sunken",
        variant === "secondary" && "border border-line-strong bg-surface text-foreground hover:bg-surface-muted",
        variant === "onDark" && "text-white/75 hover:text-white hover:bg-white/10 data-[state=open]:bg-white/10 data-[state=open]:text-white",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
