import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Product-lane toast (sonner). Sapphire's editorial toast is the web-component
 * lane; product apps use this React/sonner path. Colours are wired to the
 * Sapphire token layer, so toasts match the app surface in light and dark
 * (Sapphire flips via [data-theme]). Pass `theme` to override.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
