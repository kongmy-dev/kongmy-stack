import {
  Children,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

export interface FormFieldProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Label text. Rendered as <Label htmlFor={fieldId}>. */
  label?: ReactNode;
  /** Mark field as required (visual asterisk + required prop on the child input). */
  required?: boolean;
  /** Helper text shown under the field. Wired as aria-describedby on the child. */
  hint?: ReactNode;
  /** Error message. Overrides hint when present; sets aria-invalid on the child. */
  error?: ReactNode;
  /** The form control (Input, Textarea, NativeSelect, Select, etc.) as a single child. */
  children: ReactElement;
  /** Explicit id; auto-generated if omitted. */
  id?: string;
}

/**
 * Form field composition primitive. Wraps a single form control with:
 *  - a <Label> (htmlFor wired to the control)
 *  - an optional hint paragraph
 *  - an optional error paragraph (takes precedence over hint)
 *  - proper aria-describedby + aria-invalid on the control
 *
 *   <FormField label="Email" hint="We'll never share this." required>
 *     <Input type="email" placeholder="you@example.com" />
 *   </FormField>
 *
 * Works with any form control that accepts id, aria-describedby, and
 * aria-invalid as props — Input, Textarea, NativeSelect, Radix Select
 * (via SelectTrigger), Radix RadioGroup, Checkbox, etc.
 */
const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  (
    { className, label, required, hint, error, children, id: idProp, ...props },
    ref,
  ) => {
    const autoId = useId();
    const id = idProp || autoId;
    const descriptionIds: string[] = [];
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;

    if (error) descriptionIds.push(errorId);
    else if (hint) descriptionIds.push(hintId);

    const child = Children.only(children);
    const childProps = isValidElement(child)
      ? {
          id: (child.props as { id?: string }).id ?? id,
          'aria-describedby': descriptionIds.join(' ') || undefined,
          'aria-invalid': error ? true : undefined,
          required:
            required || (child.props as { required?: boolean }).required,
        }
      : {};

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1.5', className)}
        {...props}
      >
        {label && (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        )}
        {isValidElement(child)
          ? cloneElement(child, childProps as Partial<typeof child.props>)
          : child}
        {error ? (
          <p id={errorId} className="m-0 font-sans text-error text-xs">
            {error}
          </p>
        ) : hint ? (
          <p
            id={hintId}
            className="m-0 font-sans text-muted-foreground text-xs"
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
FormField.displayName = 'FormField';

export { FormField };
