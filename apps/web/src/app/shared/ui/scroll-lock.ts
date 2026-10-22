export const SCROLL_LOCK_ATTRIBUTE = 'data-scroll-locked';

const lockCounts = new WeakMap<Document, number>();

export function isScrollLocked(doc: Document): boolean {
  return (lockCounts.get(doc) ?? 0) > 0;
}

export function lockScroll(doc: Document): () => void {
  lockCounts.set(doc, (lockCounts.get(doc) ?? 0) + 1);
  doc.documentElement.setAttribute(SCROLL_LOCK_ATTRIBUTE, '');
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = Math.max(0, (lockCounts.get(doc) ?? 1) - 1);
    lockCounts.set(doc, remaining);
    if (remaining === 0) {
      doc.documentElement.removeAttribute(SCROLL_LOCK_ATTRIBUTE);
    }
  };
}
