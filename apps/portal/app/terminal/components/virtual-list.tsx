"use client";

import { type ReactNode, useMemo, useState } from "react";

type VirtualListProps<T> = {
  items: readonly T[];
  itemHeight: number;
  viewportHeight: number;
  overscan?: number;
  className?: string;
  keyForItem?: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
};

export function VirtualList<T>(props: VirtualListProps<T>) {
  const {
    items,
    itemHeight,
    viewportHeight,
    overscan = 6,
    className,
    keyForItem,
    renderItem,
  } = props;
  const [scrollTop, setScrollTop] = useState(0);

  const { startIndex, endIndex, totalHeight } = useMemo(() => {
    const safeHeight = Math.max(1, itemHeight);
    const safeViewport = Math.max(1, viewportHeight);
    const start = Math.max(0, Math.floor(scrollTop / safeHeight) - overscan);
    const visibleCount =
      Math.ceil(safeViewport / safeHeight) + Math.max(overscan * 2, 1);
    const end = Math.min(items.length, start + visibleCount);
    return {
      startIndex: start,
      endIndex: end,
      totalHeight: items.length * safeHeight,
    };
  }, [itemHeight, items.length, overscan, scrollTop, viewportHeight]);

  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      className={className}
      style={{ height: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map((item, offset) => {
          const index = startIndex + offset;
          const top = index * itemHeight;
          const key = keyForItem
            ? keyForItem(item, index)
            : `row-${index.toString()}`;
          return (
            <div
              key={key}
              style={{
                position: "absolute",
                top,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
