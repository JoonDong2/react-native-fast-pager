// 외부 상태 변화(리렌더, 컨트롤드 index 에코)가 진행 중인 스와이프 제스처를 방해하지 않는지 검증하는 테스트
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
import { Animated, PanResponder, View } from 'react-native';
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { ActivityState, type PagerItemProps } from '../types';

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

      return ReactModule.createElement('PagerItem', {
        activityState: props.activityState,
        itemIndex,
        position: props.position,
      });
    },
  };
});

import FastPager from '../FastPager';

type InspectableAnimatedValue = Animated.Value & {
  __getValue: () => number;
};

type SpringController = {
  finish: () => void;
  startProgress: number;
  targetProgress: number;
  stopped: boolean;
};

type PanResponderConfig = Parameters<typeof PanResponder.create>[0];

const realPanResponderCreate = PanResponder.create.bind(PanResponder);

const mockGetPosition = (
  value: number | Animated.AnimatedInterpolation<number>
) =>
  typeof value === 'number'
    ? value
    : (value as InspectableAnimatedValue).__getValue();

const gestureEvent = {} as GestureResponderEvent;

const gesture = (partial: Partial<PanResponderGestureState>) =>
  ({
    stateID: 1,
    moveX: 0,
    moveY: 0,
    x0: 0,
    y0: 0,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    numberActiveTouches: 1,
    ...partial,
  }) as PanResponderGestureState;

describe('FastPager swipe gestures under external state changes', () => {
  let renderer: ReactTestRenderer;
  let springs: SpringController[];
  let panConfig: PanResponderConfig;
  let onIndexChange: ReturnType<typeof jest.fn>;
  const pagerRef = React.createRef<InstanceType<typeof FastPager> | null>();

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    springs = [];
    onIndexChange = jest.fn();

    jest.spyOn(Animated, 'timing').mockImplementation(() => {
      return {
        start: jest.fn(),
        stop: jest.fn(),
        reset: jest.fn(),
      } as ReturnType<typeof Animated.timing>;
    });

    jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
      panConfig = config;
      return realPanResponderCreate(config);
    });

    jest.spyOn(Animated, 'spring').mockImplementation((value, config) => {
      let callback: ((result: { finished: boolean }) => void) | undefined;
      const animatedValue = value as Animated.Value;

      const controller: SpringController = {
        startProgress: (animatedValue as InspectableAnimatedValue).__getValue(),
        targetProgress: config.toValue as number,
        stopped: false,
        finish: () => {
          animatedValue.setValue(config.toValue as number);
          callback?.({ finished: true });
        },
      };
      springs.push(controller);

      return {
        start: (nextCallback) => {
          callback = nextCallback;
        },
        stop: () => {
          controller.stopped = true;
          callback?.({ finished: false });
        },
        reset: jest.fn(),
      } as ReturnType<typeof Animated.spring>;
    });
  });

  afterEach(() => {
    act(() => {
      renderer.unmount();
    });
    jest.restoreAllMocks();
  });

  // Fresh child elements on every render simulate a parent whose state
  // changes frequently for reasons unrelated to the pager.
  const pagerElement = (index: number) => (
    <FastPager
      ref={pagerRef}
      index={index}
      layout={{ width: 100 }}
      renderMode="native"
      onIndexChange={onIndexChange}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} testID={`page-${i}`} />
      ))}
    </FastPager>
  );

  const mount = (index = 0) => {
    act(() => {
      renderer = TestRenderer.create(pagerElement(index));
    });
  };

  const updateIndexProp = (index: number) => {
    act(() => {
      renderer.update(pagerElement(index));
    });
  };

  const attemptSwipe = (dx: number) => {
    let granted = false;
    act(() => {
      granted =
        panConfig.onMoveShouldSetPanResponderCapture?.(
          gestureEvent,
          gesture({ dx })
        ) === true;
      if (granted) {
        panConfig.onPanResponderGrant?.(gestureEvent, gesture({ dx }));
      }
    });
    return granted;
  };

  const beginSwipe = (dx: number) => {
    expect(attemptSwipe(dx)).toBe(true);
  };

  const moveSwipe = (dx: number) => {
    act(() => {
      panConfig.onPanResponderMove?.(gestureEvent, gesture({ dx }));
    });
  };

  const releaseSwipe = (dx: number, vx: number) => {
    act(() => {
      panConfig.onPanResponderRelease?.(gestureEvent, gesture({ dx, vx }));
    });
  };

  const terminateSwipe = (dx: number, vx: number) => {
    act(() => {
      panConfig.onPanResponderTerminate?.(gestureEvent, gesture({ dx, vx }));
    });
  };

  // React hides a frozen subtree by tearing down its layout effects: a class
  // component gets componentWillUnmount with its instance kept alive, and
  // componentDidMount again when the subtree is shown. A pager nested in
  // another pager's page goes through this on every visit.
  const hideAndShow = () => {
    act(() => {
      pagerRef.current!.componentWillUnmount();
      pagerRef.current!.componentDidMount();
    });
  };

  const finishLatestSpring = () => {
    const spring = springs.at(-1);
    expect(spring).toBeDefined();
    act(() => {
      spring!.finish();
    });
  };

  const progressValue = () =>
    (pagerRef.current!.progress as InspectableAnimatedValue).__getValue();

  // The native driver owns the progress while a transition runs; setting it
  // here stands in for the frames that pass before the finger lands.
  const advanceProgressTo = (value: number) => {
    act(() => {
      (pagerRef.current!.progress as Animated.Value).setValue(value);
    });
  };

  // The anchor a drag continues from is read back from the native side
  // asynchronously. Swallowing the read leaves the gesture without one, the
  // way a release that beats it does.
  const holdAnchorRead = () => {
    jest
      .spyOn(pagerRef.current!.progress as Animated.Value, 'stopAnimation')
      .mockImplementation(() => {});
  };

  const expectPage = (
    itemIndex: number,
    activityState: number,
    position: number
  ) => {
    const pages = renderer.root
      .findAll((node) => String(node.type) === 'PagerItem')
      .map((item) => ({
        activityState: item.props.activityState as number,
        itemIndex: item.props.itemIndex as number,
        position: mockGetPosition(
          item.props.position as number | Animated.AnimatedInterpolation<number>
        ),
      }));

    expect(pages).toContainEqual({ activityState, itemIndex, position });
  };

  it('reports the page as soon as the gesture is released', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    expect(onIndexChange).not.toHaveBeenCalled();

    releaseSwipe(-60, -1);
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expect(springs.at(-1)!.targetProgress).toBe(1);

    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expectPage(1, ActivityState.FULL_ACTIVE, 1);
  });

  it('keeps the report when the next gesture interrupts the settle', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    expect(onIndexChange.mock.calls).toEqual([[1]]);

    // The settle never comes to rest: the next gesture takes it over
    beginSwipe(-25);
    expect(springs.at(-1)!.stopped).toBe(true);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();

    expect(onIndexChange.mock.calls).toEqual([[1], [2]]);
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('does not overwrite navigation commanded from the release report', () => {
    mount(0);
    onIndexChange.mockImplementationOnce(() => {
      renderer.update(pagerElement(2));
    });

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);

    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expect(springs.at(-1)!.targetProgress).toBe(2);

    finishLatestSpring();
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('does not report a page when the released gesture snaps back', () => {
    mount(0);

    beginSwipe(-25);
    moveSwipe(-10);
    releaseSwipe(-10, 0);

    expect(springs.at(-1)!.targetProgress).toBe(0);
    expect(onIndexChange).not.toHaveBeenCalled();

    finishLatestSpring();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('returns to the current page when the responder terminates before finger-up', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-80);
    expect(progressValue()).toBeCloseTo(0.8);

    // A native responder pulls the touch away: no finger-up, no page change
    terminateSwipe(-80, -2);
    expect(springs.at(-1)!.targetProgress).toBe(0);
    expect(onIndexChange).not.toHaveBeenCalled();

    finishLatestSpring();
    expect(onIndexChange).not.toHaveBeenCalled();
    expectPage(0, ActivityState.FULL_ACTIVE, 1);
  });

  it('continues a drag from the progress on screen when it takes over a settle', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    expect(progressValue()).toBeCloseTo(0.6);
    expect(springs.at(-1)!.targetProgress).toBe(1);

    // Swiping again before the settle lands must not snap the pages to the
    // index the settle was heading for
    beginSwipe(-25);
    moveSwipe(-30);
    expect(progressValue()).toBeCloseTo(0.9);

    moveSwipe(-60);
    expect(progressValue()).toBeCloseTo(1.2);
    // The pages the progress sits between own the transition now
    expectPage(1, ActivityState.PARTIAL_ACTIVE, 0.8);
    expectPage(2, ActivityState.FULL_ACTIVE, 1.8);

    releaseSwipe(-60, -1);
    expect(springs.at(-1)!.targetProgress).toBe(2);
    expect(onIndexChange.mock.calls).toEqual([[1], [2]]);
  });

  it('keeps the pages in place when a drag takes over a multi-page transition', () => {
    mount(0);

    act(() => {
      pagerRef.current!.goTo(2);
    });
    // Halfway through 0 -> 2 the two pages on screen are that transition's own
    // ends, stretched across one screen of travel
    advanceProgressTo(1);
    expectPage(0, ActivityState.PARTIAL_ACTIVE, 0.5);
    expectPage(2, ActivityState.FULL_ACTIVE, 1.5);

    // Grabbing it may not swap the destination out for a neighbour of the
    // progress, which would drop page 2 and pull page 1 in from off screen
    beginSwipe(25);
    moveSwipe(30);
    expect(progressValue()).toBeCloseTo(0.7);
    expectPage(0, ActivityState.PARTIAL_ACTIVE, 0.65);
    expectPage(2, ActivityState.FULL_ACTIVE, 1.65);

    releaseSwipe(30, 1);
    expect(springs.at(-1)!.targetProgress).toBe(0);
    expect(onIndexChange.mock.calls).toEqual([[0]]);
  });

  it('continues to the destination when a drag over a multi-page transition decides nothing', () => {
    mount(0);

    act(() => {
      pagerRef.current!.goTo(2);
    });
    advanceProgressTo(1);

    beginSwipe(25);
    moveSwipe(10);
    releaseSwipe(10, 0);

    // Page 1 was never positioned, so the settle cannot stop there
    expect(springs.at(-1)!.targetProgress).toBe(2);
    expect(onIndexChange).not.toHaveBeenCalled();

    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[2]]);
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('resumes the transition when the gesture ends before the anchor read lands', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expect(progressValue()).toBeCloseTo(0.6);

    // A flick that grabs the settle and lets go before the anchor comes back
    // never moved a page, so it never picked one either
    holdAnchorRead();
    beginSwipe(-25);
    moveSwipe(-30);
    expect(progressValue()).toBeCloseTo(0.6);

    releaseSwipe(-60, -1);
    expect(springs.at(-1)!.targetProgress).toBe(1);
    expect(onIndexChange.mock.calls).toEqual([[1]]);

    finishLatestSpring();
    expectPage(1, ActivityState.FULL_ACTIVE, 1);
  });

  it('leaves a running settle alone when the swipe is rejected at a boundary', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    expect(springs.at(-1)!.targetProgress).toBe(2);
    const springCount = springs.length;

    // Page 2 is the last page: the gesture is refused, so the settle it would
    // otherwise have stopped has to keep running
    expect(attemptSwipe(-30)).toBe(false);
    expect(springs.at(-1)!.stopped).toBe(false);
    expect(springs.length).toBe(springCount);

    finishLatestSpring();
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('still swipes and navigates after the subtree was hidden and shown', () => {
    mount(0);

    hideAndShow();

    beginSwipe(-30);
    moveSwipe(-60);
    expect(progressValue()).toBeCloseTo(0.6);

    releaseSwipe(-60, -1);
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    finishLatestSpring();
    expectPage(1, ActivityState.FULL_ACTIVE, 1);

    // Echo of the report, then a real command from the parent
    updateIndexProp(1);
    updateIndexProp(2);
    expect(springs.at(-1)!.targetProgress).toBe(2);

    finishLatestSpring();
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('settles on its current page when hiding cuts a transition short', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);

    // Hidden while the settle is still running: nothing will ever report that
    // animation as finished, so the pager may not stay in it
    hideAndShow();
    expect(springs.at(-1)!.stopped).toBe(true);
    expectPage(1, ActivityState.FULL_ACTIVE, 1);

    updateIndexProp(1);
    updateIndexProp(0);
    expect(springs.at(-1)!.targetProgress).toBe(0);

    finishLatestSpring();
    expectPage(0, ActivityState.FULL_ACTIVE, 1);
  });

  it('keeps a live swipe unaffected by unrelated re-renders', () => {
    mount(0);

    beginSwipe(-25);
    moveSwipe(-35);
    expect(progressValue()).toBeCloseTo(0.35);

    // External state churn: same index, new children/prop identities
    updateIndexProp(0);
    updateIndexProp(0);
    updateIndexProp(0);

    expect(springs.length).toBe(0);
    expect(progressValue()).toBeCloseTo(0.35);

    moveSwipe(-50);
    expect(progressValue()).toBeCloseTo(0.5);

    releaseSwipe(-50, -1);
    expect(springs.at(-1)!.targetProgress).toBe(1);

    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expectPage(1, ActivityState.FULL_ACTIVE, 1);
  });

  it('does not yank the pager off a newer swipe when a reported index echoes back late', () => {
    mount(0);

    // Swipe 0 -> 1, settled and reported
    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1]]);

    // Swipe 1 -> 2 settles while the parent has not applied index=1 yet
    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    expect(springs.at(-1)!.targetProgress).toBe(2);
    const springCount = springs.length;

    // The delayed echo of the first report lands now
    updateIndexProp(1);

    // The pager must stay on its way to page 2 instead of being pulled back
    expect(springs.length).toBe(springCount);
    expect(springs.at(-1)!.targetProgress).toBe(2);

    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1], [2]]);
    expectPage(2, ActivityState.FULL_ACTIVE, 1);

    // The parent catching up to the second report changes nothing either
    updateIndexProp(2);
    expect(springs.length).toBe(springCount);
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });

  it('keeps a live gesture alive while stale index echoes arrive one by one', () => {
    mount(0);

    // Two reported swipes the parent has not rendered back yet
    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();
    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1], [2]]);
    const springCount = springs.length;

    // A third swipe from page 2 back toward page 1 is in progress
    beginSwipe(30);
    moveSwipe(40);
    expect(progressValue()).toBeCloseTo(1.6);

    // The parent now flushes the stale echoes mid-gesture, one render each
    updateIndexProp(1);
    updateIndexProp(2);

    // No transition may start; the finger still owns the pager
    expect(springs.length).toBe(springCount);
    moveSwipe(55);
    expect(progressValue()).toBeCloseTo(1.45);

    releaseSwipe(60, 1);
    expect(springs.at(-1)!.targetProgress).toBe(1);

    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1], [2], [1]]);
    expectPage(1, ActivityState.FULL_ACTIVE, 1);
  });

  it('still navigates on a genuine external index change', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-60);
    releaseSwipe(-60, -1);
    finishLatestSpring();
    expect(onIndexChange.mock.calls).toEqual([[1]]);

    // Echo consumed, then the parent commands a different page
    updateIndexProp(1);
    updateIndexProp(0);

    expect(springs.at(-1)!.targetProgress).toBe(0);
    finishLatestSpring();

    // Prop-driven moves are not reported back
    expect(onIndexChange.mock.calls).toEqual([[1]]);
    expectPage(0, ActivityState.FULL_ACTIVE, 1);
  });

  it('cancels the rest of a gesture when a genuine external navigation takes over', () => {
    mount(0);

    beginSwipe(-30);
    moveSwipe(-40);
    expect(progressValue()).toBeCloseTo(0.4);

    // A real command (not an echo) arrives mid-gesture: it wins
    updateIndexProp(2);
    expect(springs.at(-1)!.targetProgress).toBe(2);
    const springCount = springs.length;

    // The remainder of the gesture must not drive progress or settle
    moveSwipe(-70);
    expect(progressValue()).toBeCloseTo(0.4);
    releaseSwipe(-80, -2);
    expect(springs.length).toBe(springCount);

    finishLatestSpring();
    expect(onIndexChange).not.toHaveBeenCalled();
    expectPage(2, ActivityState.FULL_ACTIVE, 1);
  });
});
