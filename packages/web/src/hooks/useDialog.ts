'use client';

import { useEffect, useRef } from 'react';

/**
 * Dialog behaviour for the four full-screen overlays (lobby, task, meeting,
 * end).
 *
 * Three things every modal needs and none of them had: focus moved into the
 * dialog on open, Tab wrapped inside it, and Escape closing it where closing is
 * a legal move. Returns a ref to spread onto the dialog element.
 *
 * `onClose` is optional on purpose. The meeting and end overlays are *not*
 * dismissible — a player must not be able to Escape out of a vote they are
 * required to be present for, and the game-over screen is terminal — so they
 * pass nothing and get focus containment without a dismiss path.
 */
export function useDialog(opts: { onClose?: () => void; autoFocus?: boolean } = {}) {
  const { onClose, autoFocus = true } = opts;
  const ref = useRef<HTMLDivElement | null>(null);

  // Read the latest onClose from a ref so a caller passing an inline arrow does
  // not re-run this effect (and re-steal focus) on every parent render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (autoFocus) {
      // Prefer the first real control; fall back to the dialog itself so focus
      // is never left behind on the element that opened it.
      const first = focusables()[0];
      (first ?? node).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has escaped the dialog
      // entirely (which happens when the previously focused control unmounts).
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Restore focus only if it is still inside the dialog being torn down;
      // otherwise something else has legitimately claimed it since.
      if (node.contains(document.activeElement) && previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [autoFocus]);

  return ref;
}
