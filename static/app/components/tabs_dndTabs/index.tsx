import 'intersection-observer'; // polyfill

import {createContext, useState} from 'react';
import styled from '@emotion/styled';
import type {AriaTabListOptions} from '@react-aria/tabs';
import type {TabListState, TabListStateOptions} from '@react-stately/tabs';
import type {Key, Orientation} from '@react-types/shared';

import {DroppableTabList} from 'sentry/components/tabs_dndTabs/droppableTabList';
import {DroppableTabPanels} from 'sentry/components/tabs_dndTabs/droppableTabPanels';

import {tabsShouldForwardProp} from './utils';

export interface DroppableTabsProps<T>
  extends Omit<
      AriaTabListOptions<any>,
      'selectedKey' | 'defaultSelectedKey' | 'onSelectionChange' | 'isDisabled'
    >,
    Omit<
      TabListStateOptions<any>,
      | 'children'
      | 'selectedKey'
      | 'defaultSelectedKey'
      | 'onSelectionChange'
      | 'isDisabled'
    > {
  children?: React.ReactNode;
  className?: string;
  /**
   * [Uncontrolled] Default selected tab. Must match the `key` prop on the
   * selected tab item.
   */
  defaultValue?: T;
  disabled?: boolean;
  /**
   * Callback when the selected tab changes.
   */
  onChange?: (key: T) => void;
  /**
   * [Controlled] Selected tab . Must match the `key` prop on the selected tab
   * item.
   */
  value?: T;
}

interface DroppableTabContext {
  rootProps: Omit<DroppableTabsProps<any>, 'children' | 'className'>;
  setTabListState: (state: TabListState<any>) => void;
  tabListState?: TabListState<any>;
}

export const TabsContext = createContext<DroppableTabContext>({
  rootProps: {orientation: 'horizontal'},
  setTabListState: () => {},
});

/**
 * Root tabs component. Provides the necessary data (via React context) for
 * child components (TabList and TabPanels) to work together. See example
 * usage in tabs.stories.js
 */
export function DroppableTabs<T extends string | number>({
  orientation = 'horizontal',
  className,
  children,
  ...props
}: DroppableTabsProps<T>) {
  const [tabListState, setTabListState] = useState<TabListState<any>>();

  return (
    <TabsContext.Provider
      value={{rootProps: {...props, orientation}, tabListState, setTabListState}}
    >
      <TabsWrap orientation={orientation} className={className}>
        {children}
      </TabsWrap>
    </TabsContext.Provider>
  );
}

export interface Tab {
  content: React.ReactNode;
  key: Key;
  label: string;
}

export interface DragAndDropTabBarProps {
  tabs: Tab[];
}

export function DragAndDropTabBar(props: DragAndDropTabBarProps) {
  const [tabs, setTabs] = useState<Tab[]>(props.tabs);

  return (
    <DroppableTabs>
      <DroppableTabList tabs={tabs} setTabs={setTabs}>
        {tabs.map(tab => (
          <DroppableTabList.Item key={tab.key}>{tab.label}</DroppableTabList.Item>
        ))}
      </DroppableTabList>
      <DroppableTabPanels>
        {tabs.map(tab => (
          <DroppableTabPanels.Item key={tab.key}>{tab.content}</DroppableTabPanels.Item>
        ))}
      </DroppableTabPanels>
    </DroppableTabs>
  );
}

const TabsWrap = styled('div', {shouldForwardProp: tabsShouldForwardProp})<{
  orientation: Orientation;
}>`
  display: flex;
  flex-direction: ${p => (p.orientation === 'horizontal' ? 'column' : 'row')};
  flex-grow: 1;

  ${p =>
    p.orientation === 'vertical' &&
    `
      height: 100%;
      align-items: stretch;
    `};
`;
