import type { ReactElement } from 'react';
import { Animated } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

export type AnimationType = 'fade' | 'slide' | 'none' | 'fade-slide';
export type RenderMode = 'view' | 'native';

export enum ActivityState {
  INACTIVE = 0,
  PARTIAL_ACTIVE = 1,
  FULL_ACTIVE = 2,
}

export type PagerItemType =
  | ((props: {
      activityState: ActivityState;
      priority: number;
      diff: Animated.AnimatedInterpolation<number>;
    }) => ReactElement)
  | ReactElement;

export interface FastPagerProgressChangeEvent {
  nativeEvent: {
    progress: number;
  };
}

export interface FastPagerProps {
  children: PagerItemType[];
  renderMode?: RenderMode;
  layout?: {
    width?: number;
    height?: number;
  };
  vertical?: boolean;
  index?: number;
  style?: StyleProp<ViewStyle>;
  keepAlive?: number;
  onIndexChange?: (index: number) => void;
  onSwipeStart?: () => void;
  onSwipeEnd?: (index: number) => void;
  swipeEnabled?: boolean;
  onProgressChange?: (event: FastPagerProgressChangeEvent) => void;
  animationType?: AnimationType;
  onLayout?: (event: LayoutChangeEvent) => void;
  freeze?: boolean;
}

export interface FastPagerInstance {
  progress: Animated.Value;
  goTo: (index: number, animated?: boolean) => void;
}

export interface FastPagerState {
  activeIndex: number;
  mountedIndices: Set<number>;
  swipingToIndex: number | null;
  isAnimating: boolean;
  departingIndex: number | null;
  transitionTarget: number | null;
  layout: { width: number; height: number };
}

export interface PagerItemProps {
  children: PagerItemType;
  position: number | Animated.AnimatedInterpolation<number>;
  isLayoutOwner: boolean;
  containerSize: number;
  vertical?: boolean;
  animationType: AnimationType;
  activityState: ActivityState;
  priority: number;
  useNativeScreens?: boolean;
  freeze?: boolean;
}
