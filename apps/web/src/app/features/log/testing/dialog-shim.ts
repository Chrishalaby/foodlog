export function installDialogShim(): () => void {
  const proto = HTMLDialogElement.prototype;
  const keys = ['open', 'showModal', 'close'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
  });
  Object.defineProperty(proto, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
    },
  });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(proto, key, descriptor);
      } else {
        Reflect.deleteProperty(proto, key);
      }
    }
  };
}
