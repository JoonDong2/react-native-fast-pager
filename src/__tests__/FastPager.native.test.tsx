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
  position: number;
  useNativeScreens: boolean;
};

const mockPageRenders: PageRender[] = [];

type InspectableAnimatedValue = Animated.Value & {
  __getValue: () => number;
};

const mockGetPosition = (
  value: number | Animated.AnimatedInterpolation<number>
) =>
  typeof value === 'number'
    ? value
    : (value as InspectableAnimatedValue).__getValue();

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
      const child = props.children as React.ReactElement<{ testID: string }>;
      const itemIndex = Number(child.props.testID.replace('page-', ''));
      const position = mockGetPosition(props.position);

      mockPageRenders.push({
        activityState: props.activityState,
        itemIndex,
        position,
        useNativeScreens: props.useNativeScreens === true,
      });

      return ReactModule.createElement('PagerItem', {
        activityState: props.activityState,
        isLayoutOwner: props.isLayoutOwner,
        itemIndex,
        position: props.position,
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

      return {
        activityState: item.props.activityState as number,
        itemIndex,
        position: mockGetPosition(
          item.props.position as number | Animated.AnimatedInterpolation<number>
        ),
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

const expectLayoutOwner = (
  renderer: ReactTestRenderer,
  itemIndex: number,
  isLayoutOwner: boolean
) => {
  const item = renderer.root
    .findAll((node) => String(node.type) === 'PagerItem')
    .find((candidate) => candidate.props.itemIndex === itemIndex);

  expect(item?.props.isLayoutOwner).toBe(isLayoutOwner);
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

  it('parks every page in slot 0, 1, or 2 on the first render', () => {
    expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 2, ActivityState.INACTIVE, 2);
    expectLayoutOwner(renderer, 0, true);
    expectLayoutOwner(renderer, 1, false);
    expectLayoutOwner(renderer, 2, false);
  });

  it('keeps pages at fixed-slot positions for 0 -> 1', () => {
    const renders = updateIndex(1);
    const attachedTargets = renders.filter(
      (page) =>
        page.itemIndex === 1 && page.activityState === ActivityState.FULL_ACTIVE
    );

    expect(attachedTargets.length).toBeGreaterThan(0);
    expect(attachedTargets.every((page) => page.position === 2)).toBe(true);
    expect(
      renders
        .filter((page) => page.itemIndex === 0)
        .every((page) => page.position === 1)
    ).toBe(true);
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.FULL_ACTIVE, 2);
    expectPage(renderer, 2, ActivityState.INACTIVE, 2);
    expectLayoutOwner(renderer, 0, true);
    expectLayoutOwner(renderer, 1, false);

    act(() => {
      springs[0]!.setProgress(0.5);
    });
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 0.5);
    expectPage(renderer, 1, ActivityState.FULL_ACTIVE, 1.5);
    expectPage(renderer, 2, ActivityState.INACTIVE, 2);

    finishLatestSpring();
    expectPage(renderer, 0, ActivityState.INACTIVE, 0);
    expectPage(renderer, 1, ActivityState.FULL_ACTIVE, 1);
    expectPage(renderer, 2, ActivityState.INACTIVE, 2);
    expectLayoutOwner(renderer, 0, false);
    expectLayoutOwner(renderer, 1, true);
  });

  it('moves 0 -> 2 directly while page 1 stays detached in slot 2', () => {
    const renders = updateIndex(2);
    const attachedTargets = renders.filter(
      (page) =>
        page.itemIndex === 2 && page.activityState === ActivityState.FULL_ACTIVE
    );

    expect(attachedTargets.length).toBeGreaterThan(0);
    expect(attachedTargets.every((page) => page.position === 2)).toBe(true);
    expect(
      renders
        .filter((page) => page.itemIndex === 0)
        .every((page) => page.position === 1)
    ).toBe(true);
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 2);

    act(() => {
      springs[0]!.setProgress(1);
    });
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 0.5);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 1.5);

    finishLatestSpring();
    expectPage(renderer, 0, ActivityState.INACTIVE, 0);
    expectPage(renderer, 1, ActivityState.INACTIVE, 0);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 1);
  });

  it('keeps reverse 2 -> 0 transitions symmetric', () => {
    updateIndex(2);
    finishLatestSpring();

    const renders = updateIndex(0);
    const attachedTargets = renders.filter(
      (page) =>
        page.itemIndex === 0 && page.activityState === ActivityState.FULL_ACTIVE
    );

    expect(attachedTargets.length).toBeGreaterThan(0);
    expect(attachedTargets.every((page) => page.position === 0)).toBe(true);
    expectPage(renderer, 2, ActivityState.PARTIAL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.INACTIVE, 0);
    expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 0);

    act(() => {
      springs.at(-1)!.setProgress(1);
    });
    expectPage(renderer, 2, ActivityState.PARTIAL_ACTIVE, 1.5);
    expectPage(renderer, 1, ActivityState.INACTIVE, 0);
    expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 0.5);

    finishLatestSpring();
    expectPage(renderer, 2, ActivityState.INACTIVE, 2);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 1);
  });

  it('seats pages completely after repeated 0 <-> 1 transitions', () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      updateIndex(1);
      act(() => {
        springs.at(-1)!.setProgress(0.5);
      });
      expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 0.5);
      expectPage(renderer, 1, ActivityState.FULL_ACTIVE, 1.5);
      finishLatestSpring();
      expectPage(renderer, 0, ActivityState.INACTIVE, 0);
      expectPage(renderer, 1, ActivityState.FULL_ACTIVE, 1);

      updateIndex(0);
      act(() => {
        springs.at(-1)!.setProgress(0.5);
      });
      expectPage(renderer, 1, ActivityState.PARTIAL_ACTIVE, 1.5);
      expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 0.5);
      finishLatestSpring();
      expectPage(renderer, 1, ActivityState.INACTIVE, 2);
      expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 1);
    }
  });

  it('keeps page 1 detached in slot 2 during 0 -> 1 -> 0 -> 2', () => {
    updateIndex(1);
    finishLatestSpring();
    updateIndex(0);
    finishLatestSpring();

    expectPage(renderer, 0, ActivityState.FULL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);

    const renders = updateIndex(2);
    const pageOneRenders = renders.filter((page) => page.itemIndex === 1);

    expect(pageOneRenders.length).toBeGreaterThan(0);
    expect(
      pageOneRenders.every(
        (page) =>
          page.activityState === ActivityState.INACTIVE && page.position === 2
      )
    ).toBe(true);
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 1);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 2);

    act(() => {
      springs.at(-1)!.setProgress(1);
    });
    expectPage(renderer, 0, ActivityState.PARTIAL_ACTIVE, 0.5);
    expectPage(renderer, 1, ActivityState.INACTIVE, 2);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 1.5);

    finishLatestSpring();
    expectPage(renderer, 0, ActivityState.INACTIVE, 0);
    expectPage(renderer, 1, ActivityState.INACTIVE, 0);
    expectPage(renderer, 2, ActivityState.FULL_ACTIVE, 1);
  });
});
