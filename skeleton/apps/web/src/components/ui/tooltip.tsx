import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Short text label that appears on hover/focus of its trigger. Use only
 * for brief descriptive text — for rich content use HoverCard, for
 * substantive interactive panels use Popover.
 *
 * Radix requires a TooltipProvider somewhere up the tree. The default
 * `<Tooltip>` shortcut below wraps a single tooltip in its own Provider
 * for ergonomics; if you have many tooltips, wrap your app in one
 * <TooltipProvider> instead and use the lower-level pieces.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
>;

const TooltipContent = forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-sm bg-primary px-2.5 py-1.5 font-medium text-primary-foreground text-xs shadow-md',
        'data-[state=closed]:animate-out data-[state=delayed-open]:animate-in',
        'data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

export interface TooltipProps {
  /** The element that triggers the tooltip. Wrap with TooltipTrigger asChild internally. */
  children: ReactNode;
  /** The tooltip body. */
  content: ReactNode;
  /** Delay before showing, in ms. Default 300. */
  delayDuration?: number;
  /** Side relative to the trigger. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Render the tooltip without an extra provider (use if you have a TooltipProvider higher in the tree). */
  noProvider?: boolean;
}

/**
 * Single-tooltip ergonomic wrapper. For pages with many tooltips, mount
 * a single <TooltipProvider> at the root and use the lower-level pieces
 * directly to avoid duplicate provider trees.
 */
function Tooltip({
  children,
  content,
  delayDuration = 300,
  side = 'top',
  noProvider,
}: TooltipProps) {
  const inner = (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipRoot>
  );
  return noProvider ? (
    inner
  ) : (
    <TooltipProvider delayDuration={delayDuration}>{inner}</TooltipProvider>
  );
}

export { Tooltip, TooltipContent };
