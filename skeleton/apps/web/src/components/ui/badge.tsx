import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-sans font-semibold uppercase tracking-[0.04em] transition-colors',
  {
    variants: {
      variant: {
        // Foreground colors are darkened from the underlying brand/state
        // hue so 12px badge text passes WCAG AA contrast on the tinted bg.
        default: 'border border-border bg-background text-muted-foreground',
        accent: 'border border-accent/30 bg-accent/12 text-accent-text',
        dark: 'border border-border-dark bg-white/10 text-primary-foreground',
        success: 'border border-success-border bg-success-bg text-success',
        error: 'border border-error-border bg-error-bg text-error',
        warning: 'border border-warning-border bg-warning-bg text-warning',
        info: 'border border-info-border bg-info-bg text-info',
      },
      size: {
        sm: 'gap-1 px-2 py-[2px] text-[10px]',
        default: 'px-2.5 py-[3px] text-[11px]',
        lg: 'px-3 py-1 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render as child element (e.g. <a>, router Link) */
  asChild?: boolean;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span';
    return (
      <Comp
        ref={ref}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
