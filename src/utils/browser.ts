export type AnimationFrameHandle = number | ReturnType<typeof setTimeout>;
export type TimeoutHandle = number | ReturnType<typeof setTimeout>;

const noop = () => undefined;

export function getBrowserWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

export function getBrowserDocument(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

export function getElementComputedStyle(element: Element): CSSStyleDeclaration | undefined {
  const targetWindow = getBrowserWindow();
  if (targetWindow?.getComputedStyle) {
    return targetWindow.getComputedStyle(element);
  }
  return typeof getComputedStyle === 'undefined' ? undefined : getComputedStyle(element);
}

export function addWindowEventListener<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean
): () => void {
  const targetWindow = getBrowserWindow();
  if (!targetWindow) {
    return noop;
  }

  targetWindow.addEventListener(type, listener as EventListener, options);
  return () => targetWindow.removeEventListener(type, listener as EventListener, options);
}

export function addDomEventListener(
  target: EventTarget | undefined | null,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean
): () => void {
  if (!target) {
    return noop;
  }

  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

export function requestFrame(callback: FrameRequestCallback): AnimationFrameHandle {
  const targetWindow = getBrowserWindow();
  if (targetWindow?.requestAnimationFrame) {
    return targetWindow.requestAnimationFrame(callback);
  }

  return setTimeout(() => callback(Date.now()), 16);
}

export function cancelFrame(handle: AnimationFrameHandle | null): void {
  if (handle === null) {
    return;
  }

  const targetWindow = getBrowserWindow();
  if (targetWindow?.cancelAnimationFrame && typeof handle === 'number') {
    targetWindow.cancelAnimationFrame(handle);
    return;
  }

  clearTimeout(handle);
}

export function setBrowserTimeout(callback: () => void, delay: number): TimeoutHandle {
  const targetWindow = getBrowserWindow();
  if (targetWindow?.setTimeout) {
    return targetWindow.setTimeout(callback, delay);
  }

  return setTimeout(callback, delay);
}

export function clearBrowserTimeout(handle: TimeoutHandle | null): void {
  if (handle === null) {
    return;
  }

  const targetWindow = getBrowserWindow();
  if (targetWindow?.clearTimeout && typeof handle === 'number') {
    targetWindow.clearTimeout(handle);
    return;
  }

  clearTimeout(handle);
}
