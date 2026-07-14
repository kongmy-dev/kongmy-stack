import { forwardRef, type HTMLAttributes, useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  /** 1-indexed current page. */
  currentPage: number;
  /** Total number of pages. When ≤ 1, the component renders nothing. */
  totalPages: number;
  /** Fired when the user picks a page. Consumer owns state + data fetching. */
  onPageChange: (page: number) => void;
  /**
   * Window of pages shown around the current page before ellipsis kicks
   * in. With siblings=1 the rendered list looks like: 1 … 4 5 6 … 12.
   */
  siblings?: number;
  /** Hide the prev / next arrow buttons. */
  hideControls?: boolean;
}

type Item = number | 'ellipsis';

/**
 * Build the visible page list: always show first + last, a window around
 * the current page, and ellipsis tokens between the windows. Returns
 * `'ellipsis'` for gaps to keep the rendering loop free of edge cases.
 */
function buildPageList(
  currentPage: number,
  totalPages: number,
  siblings: number,
): Item[] {
  const windowStart = Math.max(2, currentPage - siblings);
  const windowEnd = Math.min(totalPages - 1, currentPage + siblings);
  const items: Item[] = [1];

  if (windowStart > 2) items.push('ellipsis');
  for (let i = windowStart; i <= windowEnd; i++) items.push(i);
  if (windowEnd < totalPages - 1) items.push('ellipsis');
  if (totalPages > 1) items.push(totalPages);

  return items;
}

const Arrow = ({ direction }: { direction: 'left' | 'right' }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d={direction === 'left' ? 'M9 3L5 7l4 4' : 'M5 3l4 4-4 4'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const buttonClass =
  'inline-flex items-center justify-center min-w-[32px] h-8 px-2 rounded-[var(--radius-btn)] font-sans text-sm font-medium cursor-pointer transition-colors border outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Presentational pagination. Consumer owns `currentPage` state and the
 * `onPageChange` handler — typically wired to URL params, TanStack Query,
 * or similar.
 */
const Pagination = forwardRef<HTMLElement, PaginationProps>(
  (
    {
      className,
      currentPage,
      totalPages,
      onPageChange,
      siblings = 1,
      hideControls,
      ...props
    },
    ref,
  ) => {
    const pages = useMemo(
      () => buildPageList(currentPage, totalPages, siblings),
      [currentPage, totalPages, siblings],
    );

    if (totalPages <= 1) return null;

    const go = (page: number) => {
      if (page < 1 || page > totalPages || page === currentPage) return;
      onPageChange(page);
    };

    return (
      <nav
        ref={ref}
        aria-label="Pagination"
        className={cn('inline-flex items-center gap-1', className)}
        {...props}
      >
        {!hideControls && (
          <button
            type="button"
            onClick={() => go(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Go to previous page"
            className={cn(
              buttonClass,
              'border-border bg-transparent text-foreground hover:bg-background',
            )}
          >
            <Arrow direction="left" />
          </button>
        )}
        {pages.map((item, i) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              aria-hidden="true"
              className="inline-flex size-8 select-none items-center justify-center text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={item === currentPage ? 'page' : undefined}
              aria-label={`Go to page ${item}`}
              className={cn(
                buttonClass,
                item === currentPage
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-transparent text-foreground hover:bg-background',
              )}
            >
              {item}
            </button>
          ),
        )}
        {!hideControls && (
          <button
            type="button"
            onClick={() => go(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Go to next page"
            className={cn(
              buttonClass,
              'border-border bg-transparent text-foreground hover:bg-background',
            )}
          >
            <Arrow direction="right" />
          </button>
        )}
      </nav>
    );
  },
);
Pagination.displayName = 'Pagination';

export { Pagination };
