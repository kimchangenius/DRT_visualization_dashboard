import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface NonPassiveWheelEvent<T extends HTMLElement = HTMLElement> {
  preventDefault: () => void;
  stopPropagation: () => void;
  currentTarget: T;
  clientX: number;
  deltaY: number;
}

export function useNonPassiveWheel<T extends HTMLElement>(
  ref: RefObject<T>,
  onWheel: (event: NonPassiveWheelEvent<T>) => void,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onWheel({
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        currentTarget: node,
        clientX: event.clientX,
        deltaY: event.deltaY,
      });
    };

    node.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleNativeWheel);
  }, [onWheel, ref]);
}
