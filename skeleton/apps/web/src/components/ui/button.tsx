import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer select-none items-center justify-center gap-2 font-sans font-semibold no-underline outline-none transition-all focus-visible:ring-(--color-focus-ring) focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
  {
    variants: {
      variant: {
        primary:
          'rounded-btn border-none bg-primary text-primary-foreground hover:bg-primary-hover',
        outline:
          'rounded-btn border-(--color-text-strong) border-[1.5px] bg-transparent text-(--color-text-strong) hover:bg-(--color-text-strong) hover:text-(--color-card-bg)',
        ghost:
          'rounded-btn border-none bg-transparent text-accent-text hover:bg-hover-overlay',
        accent:
          'rounded-btn border-none bg-accent text-primary hover:bg-accent-dark',
        'on-dark-primary':
          'rounded-btn border-none bg-accent font-bold text-primary hover:bg-accent-dark',
        'on-dark-outline':
          'rounded-btn border-[1.5px] border-white/30 bg-transparent text-primary-foreground hover:border-white hover:text-primary-foreground',
        link: 'border-none bg-transparent p-0 text-accent-text underline-offset-4 hover:text-(--color-text-strong) hover:underline',
        premium:
          'rounded-btn border-none bg-linear-to-br from-accent to-accent-dark text-primary-foreground shadow-[0_4px_14px] shadow-accent/30 hover:-translate-y-0.5 hover:shadow-[0_6px_20px] hover:shadow-accent/40',
        destructive:
          'rounded-btn border-none bg-error text-primary-foreground hover:bg-error-hover focus-visible:ring-error-ring',
        'destructive-outline':
          'rounded-btn border-[1.5px] border-error bg-transparent text-error hover:bg-error hover:text-primary-foreground focus-visible:ring-error-ring',
        'destructive-ghost':
          'rounded-btn border-none bg-transparent text-error hover:bg-hover-overlay focus-visible:ring-error-ring',
      },
      size: {
        xs: 'gap-1.5 px-2.5 py-1 text-xs',
        sm: 'px-3 py-1.5 text-[13px]',
        default: 'px-4 py-[9px] text-[14px]',
        lg: 'px-8 py-4 text-lg',
        xl: 'gap-2.5 px-10 py-5 text-xl',
        'icon-sm': 'p-1.5',
        icon: 'p-2.5',
        'icon-lg': 'p-3.5',
      },
      /** Stretch to fill the parent's inline axis — handy for mobile-first stacked CTAs. */
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

/** Icon / spinner sizing that tracks the button size so glyphs never look mismatched. */
const iconSizeBySize: Record<string, string> = {
  xs: 'text-[14px]',
  sm: 'text-[16px]',
  default: 'text-[20px]',
  lg: 'text-[22px]',
  xl: 'text-[24px]',
  'icon-sm': 'text-[16px]',
  icon: 'text-[20px]',
  'icon-lg': 'text-[24px]',
};

const spinnerSizeBySize: Record<string, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  default: 'size-4',
  lg: 'size-5',
  xl: 'size-5',
  'icon-sm': 'size-3.5',
  icon: 'size-4',
  'icon-lg': 'size-5',
};

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as child element (e.g. <a>, router Link) */
  asChild?: boolean;
  /** Material Symbols icon name */
  icon?: string;
  /** Which side of the label the icon sits on */
  iconPosition?: 'start' | 'end';
  /** Show loading spinner and disable interaction (sets aria-busy) */
  loading?: boolean;
  children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      asChild = false,
      icon,
      iconPosition = 'start',
      loading,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const iconEl =
      icon && !loading ? (
        <span
          aria-hidden="true"
          className={cn(
            'material-symbols-outlined',
            iconSizeBySize[size ?? 'default'],
          )}
        >
          {icon}
        </span>
      ) : null;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && (
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
                  spinnerSizeBySize[size ?? 'default'],
                )}
              />
            )}
            {iconPosition === 'start' && iconEl}
            {children}
            {iconPosition === 'end' && iconEl}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
