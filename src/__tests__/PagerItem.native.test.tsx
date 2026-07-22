import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Animated, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { ActivityState } from '../types';

jest.mock('react-native-screens', () => {
  const ReactModule = require('react');

  return {
    Screen: ReactModule.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        ReactModule.createElement('NativeScreen', { ...props, ref })
    ),
  };
});

import { PagerItem } from '../PagerItem';

type InspectableAnimatedNode = {
  __getValue: () => number;
};

const getNativeScreens = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === 'NativeScreen');

const getScreen = (renderer: ReactTestRenderer, testID: string) => {
  const screen = getNativeScreens(renderer).find(
    (candidate) =>
      (candidate.props.children as React.ReactElement<{ testID?: string }>)
        .props.testID === testID
  );
  expect(screen).toBeDefined();
  return screen!;
};

const readTranslation = (
  screen: ReactTestInstance,
  axis: 'translateX' | 'translateY'
) => {
  let current: ReactTestInstance | null = screen;
  let resolvedValue: number | undefined;

  while (current) {
    const style = StyleSheet.flatten(current.props.style) as
      | ViewStyle
      | undefined;
    const transforms = Array.isArray(style?.transform) ? style.transform : [];
    const transform = transforms.find((entry: object) => axis in entry) as
      | Record<typeof axis, unknown>
      | undefined;
    const value = transform?.[axis];

    if (typeof value === 'number') {
      resolvedValue ??= value;
    } else if (
      value &&
      typeof (value as unknown as InspectableAnimatedNode).__getValue ===
        'function'
    ) {
      return (value as unknown as InspectableAnimatedNode).__getValue();
    }

    current = current.parent;
  }

  expect(resolvedValue).toBeDefined();
  return resolvedValue!;
};

describe('PagerItem native rendering', () => {
  let renderer: ReactTestRenderer;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
  });

  it('uses the real Animated graph for a normalized 0 -> 2 transition', () => {
    const progress = new Animated.Value(0);

    act(() => {
      renderer = create(
        <>
          <PagerItem
            itemIndex={0}
            progress={progress}
            containerSize={100}
            isActive
            offset={new Animated.Value(0)}
            transitionDistance={2}
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
            priority={1}
            useNativeScreens
          >
            <View testID="source" />
          </PagerItem>
          <PagerItem
            itemIndex={2}
            progress={progress}
            containerSize={100}
            isActive={false}
            offset={new Animated.Value(0)}
            transitionDistance={2}
            animationType="slide"
            activityState={ActivityState.PARTIAL_ACTIVE}
            priority={2}
            useNativeScreens
          >
            <View testID="target" />
          </PagerItem>
        </>
      );
    });

    const source = getScreen(renderer, 'source');
    const target = getScreen(renderer, 'target');
    expect(source.props.activityState).toBe(ActivityState.FULL_ACTIVE);
    expect(target.props.activityState).toBe(ActivityState.PARTIAL_ACTIVE);
    expect(readTranslation(source, 'translateX')).toBe(0);
    expect(readTranslation(target, 'translateX')).toBe(100);

    act(() => progress.setValue(1));
    expect(readTranslation(source, 'translateX')).toBe(-50);
    expect(readTranslation(target, 'translateX')).toBe(50);

    act(() => progress.setValue(2));
    expect(readTranslation(source, 'translateX')).toBe(-100);
    expect(readTranslation(target, 'translateX')).toBe(0);
  });

  it('keeps an inactive native page detached and frozen', () => {
    act(() => {
      renderer = create(
        <PagerItem
          itemIndex={1}
          progress={new Animated.Value(0)}
          containerSize={100}
          isActive={false}
          offset={new Animated.Value(0)}
          transitionDistance={1}
          animationType="slide"
          activityState={ActivityState.INACTIVE}
          priority={0}
          useNativeScreens
          freeze
        >
          <View testID="inactive" />
        </PagerItem>
      );
    });

    const inactive = getScreen(renderer, 'inactive');
    expect(inactive.props.activityState).toBe(ActivityState.INACTIVE);
    expect(inactive.props.shouldFreeze).toBe(true);
    expect(inactive.props.pointerEvents).toBe('none');
  });

  it('keeps reverse vertical 2 -> 0 positions symmetric', () => {
    const progress = new Animated.Value(2);

    act(() => {
      renderer = create(
        <>
          <PagerItem
            itemIndex={2}
            progress={progress}
            containerSize={100}
            vertical
            isActive
            offset={new Animated.Value(0)}
            transitionDistance={2}
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
            priority={2}
            useNativeScreens
          >
            <View testID="reverse-source" />
          </PagerItem>
          <PagerItem
            itemIndex={0}
            progress={progress}
            containerSize={100}
            vertical
            isActive={false}
            offset={new Animated.Value(0)}
            transitionDistance={2}
            animationType="slide"
            activityState={ActivityState.PARTIAL_ACTIVE}
            priority={1}
            useNativeScreens
          >
            <View testID="reverse-target" />
          </PagerItem>
        </>
      );
    });

    const source = getScreen(renderer, 'reverse-source');
    const target = getScreen(renderer, 'reverse-target');
    expect(readTranslation(source, 'translateY')).toBe(0);
    expect(readTranslation(target, 'translateY')).toBe(-100);

    act(() => progress.setValue(1));
    expect(readTranslation(source, 'translateY')).toBe(50);
    expect(readTranslation(target, 'translateY')).toBe(-50);

    act(() => progress.setValue(0));
    expect(readTranslation(source, 'translateY')).toBe(100);
    expect(readTranslation(target, 'translateY')).toBe(0);
  });
});
