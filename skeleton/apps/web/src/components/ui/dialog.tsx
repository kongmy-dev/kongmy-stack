import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';

/* ─── Root ──────────────────────────────────────────────────────────── */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

/* ─── Overlay ───────────────────────────────────────────────────────── */

const DialogOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-1000 bg-primary/85 backdrop-blur-xs',
      'data-[state=closed]:animate-[fadeOut_150ms_ease] data-[state=open]:animate-[fadeIn_200ms_ease]',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

/* ─── Content ───────────────────────────────────────────────────────── */

const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Max width CSS value */
    maxWidth?: string;
    /** Hide the default close button */
    hideClose?: boolean;
    /** Accessible label for the close button (override for i18n) */
    closeLabel?: string;
  }
>(
  (
    {
      className,
      children,
      maxWidth = '800px',
      hideClose = false,
      closeLabel = 'Close',
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          '-translate-1/2 fixed top-1/2 left-1/2 z-1001',
          'flex max-h-[85vh] w-[calc(100vw-2rem)] flex-col sm:w-[90%]',
          'rounded-md bg-(--color-card-bg) shadow-(--shadow-lg)',
          'data-[state=closed]:animate-[dialogOut_150ms_ease] data-[state=open]:animate-[dialogIn_200ms_ease]',
          'outline-none',
          className,
        )}
        style={{ maxWidth }}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-muted-foreground outline-none transition-colors hover:bg-background hover:text-(--color-text-strong) focus-visible:ring-(--color-focus-ring) focus-visible:ring-2"
          >
            <Icon name="close" size={18} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = 'DialogContent';

/* ─── Header ────────────────────────────────────────────────────────── */

const DialogHeader = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-between border-border border-b px-6 py-4',
      className,
    )}
    {...props}
  />
));
DialogHeader.displayName = 'DialogHeader';

/* ─── Title ─────────────────────────────────────────────────────────── */

const DialogTitle = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'm-0 font-semibold font-serif text-(--color-text-strong) text-lg',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

/* ─── Description ───────────────────────────────────────────────────── */

const DialogDescription = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-1 font-sans text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

/* ─── Body ──────────────────────────────────────────────────────────── */

const DialogBody = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex-1 overflow-y-auto px-6 py-5', className)}
    {...props}
  />
));
DialogBody.displayName = 'DialogBody';

/* ─── Footer ────────────────────────────────────────────────────────── */

const DialogFooter = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex justify-end gap-3 border-border border-t px-6 py-4',
      className,
    )}
    {...props}
  />
));
DialogFooter.displayName = 'DialogFooter';

/* ─── ConfirmDialog (pre-composed) ──────────────────────────────────── */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  /** Red confirm button */
  isDanger?: boolean;
  children?: ReactNode;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false,
}: ConfirmDialogProps) {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="420px" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="m-0 font-sans text-sm/relaxed text-muted-foreground">
            {message}
          </p>
        </DialogBody>
        <DialogFooter>
          <button
            onClick={handleCancel}
            className="cursor-pointer rounded-btn border border-border bg-background px-5 py-2.5 font-medium font-sans text-(--color-text-strong) text-sm outline-none transition-colors hover:bg-border focus-visible:ring-(--color-focus-ring) focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={cn(
              'cursor-pointer rounded-btn border-none px-5 py-2.5 font-medium font-sans text-sm text-primary-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2',
              isDanger
                ? 'bg-error hover:bg-error-hover focus-visible:ring-error-ring'
                : 'bg-primary hover:bg-primary-hover focus-visible:ring-(--color-focus-ring)',
            )}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
