const MAX_RETURN_CHAIN = 16;

const returnTargets = new WeakMap<HTMLDialogElement, HTMLElement | null>();

export function captureReturnFocus(doc: Document, dialog: HTMLDialogElement): HTMLElement | null {
  const active = doc.activeElement;
  const target =
    active instanceof HTMLElement && active !== doc.body && !dialog.contains(active)
      ? active
      : null;
  returnTargets.set(dialog, target);
  return target;
}

export function resolveReturnTarget(start: HTMLElement | null): HTMLElement | null {
  let target = start;
  for (let hops = 0; target && hops < MAX_RETURN_CHAIN; hops++) {
    const host = target.closest('dialog');
    if (!host || host.open) {
      return target;
    }
    target = returnTargets.get(host) ?? null;
  }
  return null;
}

export function restoreFocusAfterClose(
  doc: Document,
  dialog: HTMLDialogElement,
  start: HTMLElement | null,
): void {
  const target = resolveReturnTarget(start);
  if (!target?.isConnected) {
    return;
  }
  const active = doc.activeElement;
  const activeDialog = active instanceof Element ? active.closest('dialog') : null;
  const focusLost =
    !active ||
    active === doc.body ||
    activeDialog === dialog ||
    (activeDialog !== null && !activeDialog.open);
  if (focusLost && active !== target) {
    target.focus({ preventScroll: true });
  }
}
