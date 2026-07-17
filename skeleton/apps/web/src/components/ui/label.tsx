import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const labelVariants = cva(
  'mb-1 block font-sans font-semibold text-(--color-text-strong)',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-base',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {
  /** Show red asterisk for required fields */
  required?: boolean | undefined;
}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, size, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(labelVariants({ size }), className)}
        {...props}
      >
        {children}
        {required && (
          <span className="ml-0.5 text-accent" aria-hidden="true">
            *
          </span>
        )}
      </label>
    );
  },
);
Label.displayName = 'Label';

export { Label, labelVariants };
