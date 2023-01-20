import {
  TreeLike,
  UseVirtualizedListProps,
} from 'sentry/utils/profiling/hooks/useVirtualizedTree/useVirtualizedTree';
import {VirtualizedTree} from 'sentry/utils/profiling/hooks/useVirtualizedTree/VirtualizedTree';
import {VirtualizedTreeNode} from 'sentry/utils/profiling/hooks/useVirtualizedTree/VirtualizedTreeNode';

import {VirtualizedState} from './useVirtualizedTreeReducer';

/**
 * Recursively calls requestAnimationFrame until a specified delay has been met or exceeded.
 * When the delay time has been reached the function you're timing out will be called.
 * This was copied from react-virtualized, with credits to the original author.
 *
 * Credit: Joe Lambert (https://gist.github.com/joelambert/1002116#file-requesttimeout-js)
 */
type AnimationTimeoutId = {
  id: number;
};

export function requestAnimationTimeout(
  callback: Function,
  delay: number
): AnimationTimeoutId {
  let start;
  // wait for end of processing current event handler, because event handler may be long
  Promise.resolve().then(() => {
    start = Date.now();
  });

  const timeout = () => {
    if (start === undefined) {
      frame.id = window.requestAnimationFrame(timeout);
      return;
    }
    if (Date.now() - start >= delay) {
      callback();
    } else {
      frame.id = window.requestAnimationFrame(timeout);
    }
  };

  const frame: AnimationTimeoutId = {
    id: window.requestAnimationFrame(timeout),
  };

  return frame;
}

export function cancelAnimationTimeout(frame: AnimationTimeoutId) {
  window.cancelAnimationFrame(frame.id);
}

export function findOptimisticStartIndex<T extends TreeLike>({
  items,
  overscroll,
  rowHeight,
  scrollTop,
  viewport,
}: {
  items: VirtualizedTreeNode<T>[];
  overscroll: number;
  rowHeight: number;
  scrollTop: number;
  viewport: {bottom: number; top: number};
}): number {
  if (!items.length || viewport.top === 0) {
    return 0;
  }
  return Math.max(Math.floor(scrollTop / rowHeight) - overscroll, 0);
}

export interface VirtualizedTreeRenderedRow<T> {
  item: VirtualizedTreeNode<T>;
  key: number;
  ref: HTMLElement | null;
  styles: React.CSSProperties;
}

export function findRenderedItems<T extends TreeLike>({
  items,
  overscroll,
  rowHeight,
  scrollHeight,
  scrollTop,
}: {
  items: VirtualizedTreeNode<T>[];
  overscroll: NonNullable<UseVirtualizedListProps<T>['overscroll']>;
  rowHeight: UseVirtualizedListProps<T>['rowHeight'];
  scrollHeight: VirtualizedState<T>['scrollHeight'];
  scrollTop: number;
}) {
  // This is overscroll height for single direction, when computing the total,
  // we need to multiply this by 2 because we overscroll in both directions.
  const OVERSCROLL_HEIGHT = overscroll * rowHeight;
  const renderedRows: VirtualizedTreeRenderedRow<T>[] = [];

  // Clamp viewport to scrollHeight bounds [0, length * rowHeight] because some browsers may fire
  // scrollTop with negative values when the user scrolls up past the top of the list (overscroll behavior)
  const viewport = {
    top: Math.max(scrollTop - OVERSCROLL_HEIGHT, 0),
    bottom: Math.min(
      scrollTop + scrollHeight + OVERSCROLL_HEIGHT,
      items.length * rowHeight
    ),
  };

  // Points to the position inside the visible array
  let visibleItemIndex = 0;
  // Points to the currently iterated item
  let indexPointer = findOptimisticStartIndex({
    items,
    viewport,
    scrollTop,
    rowHeight,
    overscroll,
  });

  // Max number of visible items in our list
  const MAX_VISIBLE_ITEMS = Math.ceil((scrollHeight + OVERSCROLL_HEIGHT * 2) / rowHeight);
  const ALL_ITEMS = items.length;

  // While number of visible items is less than max visible items, and we haven't reached the end of the list
  while (visibleItemIndex < MAX_VISIBLE_ITEMS && indexPointer < ALL_ITEMS) {
    const elementTop = indexPointer * rowHeight;
    const elementBottom = elementTop + rowHeight;

    // An element is inside a viewport if the top of the element is below the top of the viewport
    // and the bottom of the element is above the bottom of the viewport
    if (elementTop >= viewport.top && elementBottom <= viewport.bottom) {
      renderedRows[visibleItemIndex] = {
        key: indexPointer,
        ref: null,
        styles: {position: 'absolute', top: elementTop, height: rowHeight},
        item: items[indexPointer],
      };

      visibleItemIndex++;
    }
    indexPointer++;
  }

  return renderedRows;
}

// Finds index of the previously selected node in the tree
export function findCarryOverIndex<T extends TreeLike>(
  previousNode: VirtualizedTreeNode<T> | null | undefined,
  newTree: VirtualizedTree<T>
): number | null {
  if (!newTree.flattened.length || !previousNode) {
    return null;
  }

  const newIndex = newTree.flattened.findIndex(n => n.node === previousNode.node);
  if (newIndex === -1) {
    return null;
  }
  return newIndex;
}

export function computeVirtualizedTreeNodeScrollTop(
  {
    index,
    rowHeight,
    scrollHeight,
    currentScrollTop,
  }: {
    currentScrollTop: number;
    index: number;
    rowHeight: number;
    scrollHeight: number;
  },
  block: 'start' | 'center' | 'end' | 'nearest' = 'nearest'
) {
  const newPosition = index * rowHeight;

  if (block === 'start') {
    return newPosition;
  }

  if (block === 'center') {
    return newPosition - scrollHeight / 2 + rowHeight;
  }

  if (block === 'end') {
    return newPosition - scrollHeight + rowHeight;
  }

  const top = newPosition;
  const bottom = newPosition + scrollHeight;

  return Math.min(top - currentScrollTop, bottom - currentScrollTop);
}
