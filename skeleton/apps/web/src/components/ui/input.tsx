import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  'w-full font-sans outline-none transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:focus:shadow-error/12',
  {
    variants: {
      variant: {
        default:
          'rounded-btn border border-border bg-(--color-card-bg) text-foreground focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/12',
        dark: 'rounded-sm border border-border-dark bg-black/20 text-primary-foreground focus:border-accent',
        mono: 'rounded-btn border border-border bg-background font-mono text-sm text-foreground focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/12',
      },
      size: {
        sm: 'px-3 py-2 text-sm',
        default: 'px-4 py-3 text-base',
        lg: 'px-5 py-4 text-lg',
      },
    },
    compoundVariants: [
      // dark variant historically used tighter padding — preserved at default size
      { variant: 'dark', size: 'default', className: 'px-3 py-2.5' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input, inputVariants };
