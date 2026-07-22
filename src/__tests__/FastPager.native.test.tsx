import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import React from 'react';
import { Animated, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { ActivityState, type PagerItemProps } from '../types';

type PageRender = {
  activityState: number;
  itemIndex: number;
  offset: number;
  position: number;
  progress: number;
  transitionDistance: number;
  useNativeScreens: boolean;
};

const mockPageRenders: PageRender[] = [];

type InspectableAnimatedValue = Animated.Value & {
  __getValue: () => number;
};

const mockGetAnimatedValue = (value: Animated.Value) =>
  (value as InspectableAnimatedValue).__getValue();

jest.mock('react-native-screens', () => {
  const ReactModule = require('react');

  return {
    ScreenContainer: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement('ScreenContainer', null, children),
  };
});

jest.mock('../PagerItem', () => {
  const ReactModule = require('react');

  return {
    PagerItem: (props: PagerItemProps) => {
      const progress = mockGetAnimatedValue(props.progress);
      const offset = mockGetAnimatedValue(props.offset);
      // Keep the harness runnable against the pre-fix implementation, which
      // did not yet pass an explicit normalized transition distance.
      const transitionDistance = props.transitionDistance ?? 1;
      const position =
        (props.itemIndex + offset - progress) / transitionDistance;

      mockPageRenders.push({
        activityState: props.activityState,
        itemIndex: props.itemIndex,
        offset,
        position,
        progress,
        transitionDistance,
        useNativeScreens: props.useNativeScreens === true,
      });

      return ReactModule.createElement('PagerItem', {
        activityState: props.activityState,
        itemIndex: props.itemIndex,
        offset: props.offset,
        progress: props.progress,
        transitionDistance,
        useNativeScreens: props.useNativeScreens,
      });
    },
  };
});

import FastPager from '../FastPager';

type SpringController = {
  finish: () => void;
  setProgress: (value: number) => void;
};

const children = [0, 1, 2].map((index) => (
  <View key={index} testID={`page-${index}`} />
));

const pager = (index: number) => (
  <FastPager index={index} layout={{ width: 100 }} renderMode="native">
    {children}
  </FastPager>
);

const readPages = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => String(node.type) === 'PagerItem')
    .map((item) => {
      const itemIndex = item.props.itemIndex as number;
      const progress = mockGetAnimatedValue(
        item.props.progress as Animated.Value
      );
      const offset = mockGetAnimatedValue(item.props.offset as Animated.Value);
      const transitionDistance =
        (item.props.transitionDistance as number | undefined) ?? 1;

      return {
        activityState: item.props.activityState as number,
        itemIndex,
        position: (itemIndex + offset - progress) / transitionDistance,
        useNativeScreens: item.props.useNativeScreens as boolean,
      };
    });

const expectPage = (
  renderer: ReactTestRenderer,
  itemIndex: number,
  activityState: number,
  position: number
) => {
  expect(readPages(renderer)).toContainEqual({
    activityState,
    itemIndex,
    position,
    useNativeScreens: true,
  });
};

describe('FastPager native screen transitions', () => {
  let renderer: ReactTestRenderer;
  let springs: SpringController[];

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    springs = [];
    mockPageRenders.length = 0;

    jest.spyOn(Animated, 'spring').mockImplementation((value, config) => {
      let callback: ((result: { finished: boolean }) => void) | undefined;
      const animatedValue = value as Animated.Value;

      springs.push({
        setProgress: (progress) => {
          animatedValue.setValue(progress);
        },
        finish: () => {
          animatedValue.setValue(config.toValue as number);
          callback?.({ finished: true });
        },
      });

      return {
        start: (nextCallback) => {
          callback = nextCallback;
        },
        stop: () => {
          callback?.({ finished: false });
        },
        reset: jest.fn(),
      } as ReturnType<typeof Animated.spring>;
    });

    act(() => {
      renderer = TestRenderer.create(pager(0));
    });
  });

  afterEach(() => {
    act(() => {
      renderer.unmount();
    });
    jest.restoreAllMocks();
  });

  const updateIndex = (index: number) => {
    mockPageRenders.length = 0;
    act(() => {
      renderer.update(pager(index));
    });
    return [...mockPageRenders];
  };

  const finishLatestSpring = () => {
    const spring = springs.at(-1);
    expect(spring).toBeDefined();
    act(() => {
      spring!.finish();
    });
  };

  it('keeps pages at valid positions for 0 -> 1', () => {
    const renders = updateIndex(1);

    expect(renders.find((page) => page.itemIndex === 1)).toMatchObject({
      activityState: 1,
      position: 1,
      useNativeScreens: true,
    });
    expectPage(renderer, 0, 2, 0);
    expectPage(renderer, 1, 1, 1);

    act(() => {
      springs[0]!.setProgress(0.5);
    });
    expectPage(renderer, 0, 2, -0.5);
    expectPage(renderer, 1, 1, 0.5);

    finishLatestSpring();
    expectPage(renderer, 0, 0, -1);
    expectPage(renderer, 1, 2, 0);
  });

  it('moves 0 -> 2 as one step without attaching an incorrectly positioned page', () => {
    const renders = updateIndex(2);
    const firstTargetRender = renders.find((page) => page.itemIndex === 2);

    expect(firstTargetRender).toMatchObject({
      activityState: 1,
      position: 1,
      progress: 0,
      transitionDistance: 2,
      useNativeScreens: true,
    });
    expect(
      renders
        .filter((page) => page.itemIndex === 0)
        .every((page) => page.position === 0)
    ).toBe(true);
    expect(renders).not.toContainEqual(
      expect.objectContaining({ itemIndex: 2, activityState: 0 })
    );
    expectPage(renderer, 0, 2, 0);
    expectPage(renderer, 2, 1, 1);

    act(() => {
      springs[0]!.setProgress(1);
    });
    expectPage(renderer, 0, 2, -0.5);
    expectPage(renderer, 2, 1, 0.5);

    finishLatestSpring();
    expectPage(renderer, 0, 0, -2);
    expectPage(renderer, 2, 2, 0);
  });

  it('keeps reverse 2 -> 0 transitions symmetric after both pages were mounted', () => {
    updateIndex(2);
    finishLatestSpring();

    const renders = updateIndex(0);
    const attachedTarget = renders.find(
      (page) =>
        page.itemIndex === 0 &&
        page.activityState === ActivityState.PARTIAL_ACTIVE
    );

    expect(attachedTarget).toMatchObject({
      position: -1,
      progress: 2,
      transitionDistance: 2,
      useNativeScreens: true,
    });
    expect(
      renders
        .filter((page) => page.itemIndex === 2)
        .every((page) => page.position === 0)
    ).toBe(true);
    expectPage(renderer, 2, 2, 0);
    expectPage(renderer, 0, 1, -1);

    act(() => {
      springs.at(-1)!.setProgress(1);
    });
    expectPage(renderer, 2, 2, 0.5);
    expectPage(renderer, 0, 1, -0.5);

    finishLatestSpring();
    expectPage(renderer, 2, 0, 2);
    expectPage(renderer, 0, 2, 0);
  });

  it('keeps page 1 detached during 0 -> 1 -> 0 -> 2', () => {
    updateIndex(1);
    finishLatestSpring();
    updateIndex(0);
    finishLatestSpring();

    const renders = updateIndex(2);
    const pageOneRenders = renders.filter((page) => page.itemIndex === 1);

    expect(pageOneRenders.length).toBeGreaterThan(0);
    expect(pageOneRenders.every((page) => page.activityState === 0)).toBe(true);
    expect(renders.find((page) => page.itemIndex === 2)).toMatchObject({
      activityState: 1,
      position: 1,
      progress: 0,
      transitionDistance: 2,
      useNativeScreens: true,
    });
    expectPage(renderer, 0, 2, 0);
    expectPage(renderer, 1, 0, 0.5);
    expectPage(renderer, 2, 1, 1);

    act(() => {
      springs.at(-1)!.setProgress(1);
    });
    expectPage(renderer, 0, 2, -0.5);
    expectPage(renderer, 1, 0, 0);
    expectPage(renderer, 2, 1, 0.5);

    finishLatestSpring();
    expectPage(renderer, 0, 0, -2);
    expectPage(renderer, 1, 0, -1);
    expectPage(renderer, 2, 2, 0);
  });
});
