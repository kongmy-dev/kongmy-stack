import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sapphire UI uses Material Symbols (via Google Fonts) as the canonical
 * icon system. Consumers must load the font in their app shell — either
 * via a <link> tag (see materialSymbolsFontHref / materialSymbolsLinkTag
 * exports below) or by self-hosting the font files.
 *
 * Astro example:
 *   <link rel="stylesheet" href={materialSymbolsFontHref()} />
 * React/Next example:
 *   <Head><link rel="stylesheet" href={materialSymbolsFontHref()} /></Head>
 */
export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  /** Material Symbols icon name (e.g. "cloud", "smart_toy"). Find names at
   *  https://fonts.google.com/icons */
  name: string;
  /** Icon size in pixels */
  size?: number;
  /** Use filled variant */
  filled?: boolean;
  /** Font weight (100–700) */
  weight?: number;
}

function Icon({
  name,
  size = 24,
  filled = false,
  weight = 300,
  className,
  style,
  ...props
}: IconProps) {
  return (
    <span
      className={cn('material-symbols-outlined', className)}
      style={{
        fontSize: size,
        fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" ${weight}, "GRAD" 0, "opsz" ${size}`,
        ...style,
      }}
      aria-hidden={props['aria-label'] ? undefined : 'true'}
      {...props}
    >
      {name}
    </span>
  );
}

export { Icon };

/**
 * The Google Fonts URL for the Material Symbols Outlined font, configured
 * with the axes Sapphire UI uses (opsz, wght, FILL, GRAD).
 */
export function materialSymbolsFontHref(): string {
  return 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-25..0&display=block';
}

/**
 * Ready-to-inject HTML for the font link tag. Useful for Astro/HTML
 * consumers building a head fragment via string concatenation.
 */
export function materialSymbolsLinkTag(): string {
  return `<link rel="stylesheet" href="${materialSymbolsFontHref()}" />`;
}
