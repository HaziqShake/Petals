import { useState, useCallback, useRef } from 'react';

export function usePullToRefresh(onRefresh: () => Promise<void>, threshold = 70) {
  const [pullDist, setPullDist] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only track if we are at the top of the scroll
    const scrollNode = e.currentTarget as HTMLElement;
    if (scrollNode.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = null;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const dist = currentY - startY.current;

    if (dist > 0) {
      // Apply some resistance (logarithmic-ish)
      const easedDist = Math.min(dist * 0.4, threshold + 20);
      setPullDist(easedDist);
      
      // Prevent browser default pull-to-refresh if we are handling it
      if (dist > 10 && e.cancelable) {
        e.preventDefault();
      }
    } else {
      setPullDist(0);
    }
  }, [isRefreshing, threshold]);

  const onTouchEnd = useCallback(async () => {
    if (startY.current === null || isRefreshing) return;

    if (pullDist >= threshold) {
      setIsRefreshing(true);
      setPullDist(threshold);
      
      await onRefresh();
      
      // Mimic a short "syncing" feel
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDist(0);
      }, 800);
    } else {
      setPullDist(0);
    }
    startY.current = null;
  }, [pullDist, threshold, isRefreshing, onRefresh]);

  return {
    pullDist,
    isRefreshing,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    }
  };
}
