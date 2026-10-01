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
import type {
  ReactTestInstance,
  ReactTestRenderer,
  ReactTestRendererJSON,
} from 'react-test-renderer';
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

// Page content sits behind a Freeze boundary, so the test id is looked up in
// the screen's subtree rather than on its immediate child.
const getScreen = (renderer: ReactTestRenderer, testID: string) => {
  const screen = getNativeScreens(renderer).find(
    (candidate) =>
      candidate.findAll((node) => node.props?.testID === testID).length > 0
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

const readPositionStyle = (screen: ReactTestInstance) => {
  let current: ReactTestInstance | null = screen;

  while (current) {
    const props = current.props as { style?: ViewStyle } | null;
    const style = StyleSheet.flatten(props?.style) as ViewStyle | undefined;
    if (style?.position) return style.position;
    current = current.parent;
  }

  return undefined;
};

const FREEZE_DELAY = 300;

// A frozen page stops re-rendering, so counting its content's renders tells a
// frozen page from a live one.
const createCountingPage = () => {
  const counter = { renders: 0 };
  const Content = () => {
    counter.renders += 1;
    return <View testID="counting" />;
  };
  const render = (activityState: ActivityState) => (
    <PagerItem
      position={activityState === ActivityState.INACTIVE ? 2 : 1}
      isLayoutOwner={activityState === ActivityState.FULL_ACTIVE}
      containerSize={100}
      animationType="slide"
      activityState={activityState}
      priority={activityState}
      useNativeScreens
      freeze
      freezeDelay={FREEZE_DELAY}
    >
      <Content />
    </PagerItem>
  );
  return { counter, render };
};

describe('PagerItem native rendering', () => {
  let renderer: ReactTestRenderer;

  const update = (element: React.ReactElement) => {
    act(() => {
      renderer.update(element);
    });
  };

  const advance = (ms: number) => {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
  };

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
    jest.useRealTimers();
  });

  it('uses the real Animated graph for a fixed-slot 0 -> 2 transition', () => {
    const progress = new Animated.Value(0);
    const normalizedProgress = Animated.divide(progress, 2);
    const sourcePosition = Animated.subtract(1, normalizedProgress);
    const targetPosition = Animated.add(
      2,
      Animated.multiply(-1, normalizedProgress)
    );

    act(() => {
      renderer = create(
        <>
          <PagerItem
            position={sourcePosition}
            isLayoutOwner={false}
            containerSize={100}
            animationType="slide"
            activityState={ActivityState.PARTIAL_ACTIVE}
            priority={1}
            useNativeScreens
          >
            <View testID="source" />
          </PagerItem>
          <PagerItem
            position={targetPosition}
            isLayoutOwner
            containerSize={100}
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
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
    expect(source.props.activityState).toBe(ActivityState.PARTIAL_ACTIVE);
    expect(target.props.activityState).toBe(ActivityState.FULL_ACTIVE);
    expect(readPositionStyle(source)).toBe('absolute');
    expect(readPositionStyle(target)).toBeUndefined();
    expect(readTranslation(source, 'translateX')).toBe(0);
    expect(readTranslation(target, 'translateX')).toBe(100);

    act(() => progress.setValue(1));
    expect(readTranslation(source, 'translateX')).toBe(-50);
    expect(readTranslation(target, 'translateX')).toBe(50);

    act(() => progress.setValue(2));
    expect(readTranslation(source, 'translateX')).toBe(-100);
    expect(readTranslation(target, 'translateX')).toBe(0);
  });

  it('keeps an inactive native page detached, mounted once and frozen', () => {
    jest.useFakeTimers();
    let renders = 0;
    let mounts = 0;
    const Content = () => {
      renders += 1;
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <View testID="inactive" />;
    };

    const item = (containerSize: number) => (
      <PagerItem
        position={2}
        isLayoutOwner={false}
        containerSize={containerSize}
        animationType="slide"
        activityState={ActivityState.INACTIVE}
        priority={0}
        useNativeScreens
        freeze
      >
        <Content />
      </PagerItem>
    );

    act(() => {
      renderer = create(item(100));
    });

    const inactive = getNativeScreens(renderer)[0];
    expect(inactive).toBeDefined();
    expect(inactive!.props.activityState).toBe(ActivityState.INACTIVE);
    // The screens' own delayed freeze stays off; the content is frozen directly.
    expect(inactive!.props.shouldFreeze).toBe(false);
    expect(inactive!.props.pointerEvents).toBe('none');
    expect(readPositionStyle(inactive!)).toBe('absolute');
    expect(readTranslation(inactive!, 'translateX')).toBe(100);
    // Freeze stops a page that exists; it must not keep one from existing, or
    // a page rendered up front would never mount at all.
    expect(renders).toBe(1);
    expect(mounts).toBe(1);

    // Once it has been inactive for the default freezeDelay the page is
    // frozen, so it stops re-rendering.
    advance(1000);
    update(item(120));
    expect(renders).toBe(1);
  });

  it('leaves an inactive page unrendered until the container is measured', () => {
    let renders = 0;

    const Content = () => {
      renders += 1;
      return <View testID="unmeasured-inactive" />;
    };

    act(() => {
      renderer = create(
        <PagerItem
          position={2}
          isLayoutOwner={false}
          containerSize={0}
          animationType="slide"
          activityState={ActivityState.INACTIVE}
          priority={0}
          useNativeScreens
          freeze
        >
          <Content />
        </PagerItem>
      );
    });

    // A page that has never been shown cannot be laid out at a container size
    // that is not settled yet.
    expect(renders).toBe(0);
  });

  it('freezes a page only once it has stayed inactive for freezeDelay', () => {
    jest.useFakeTimers();
    const page = createCountingPage();

    act(() => {
      renderer = create(page.render(ActivityState.FULL_ACTIVE));
    });
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(2);

    // Re-rendering while it waits does not start the delay over.
    advance(FREEZE_DELAY - 1);
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(3);

    advance(1);
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(3);
  });

  it('never freezes a page that comes back before freezeDelay runs out', () => {
    jest.useFakeTimers();
    const page = createCountingPage();

    act(() => {
      renderer = create(page.render(ActivityState.FULL_ACTIVE));
    });
    update(page.render(ActivityState.INACTIVE));
    advance(200);
    update(page.render(ActivityState.PARTIAL_ACTIVE));
    update(page.render(ActivityState.INACTIVE));

    // Past the first departure's deadline the page is still live: coming back
    // cancelled that countdown, and leaving again started a new one.
    advance(200);
    const renders = page.counter.renders;
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(renders + 1);

    advance(FREEZE_DELAY - 200);
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(renders + 1);
  });

  it('unfreezes a page as soon as it comes back and waits out freezeDelay again', () => {
    jest.useFakeTimers();
    const page = createCountingPage();

    act(() => {
      renderer = create(page.render(ActivityState.FULL_ACTIVE));
    });
    update(page.render(ActivityState.INACTIVE));
    advance(FREEZE_DELAY);
    const renders = page.counter.renders;
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(renders);

    update(page.render(ActivityState.PARTIAL_ACTIVE));
    expect(page.counter.renders).toBe(renders + 1);

    // Having been frozen once does not freeze it the moment it leaves again.
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(renders + 2);

    advance(FREEZE_DELAY);
    update(page.render(ActivityState.INACTIVE));
    expect(page.counter.renders).toBe(renders + 2);
  });

  it('keeps reverse vertical 2 -> 0 positions symmetric', () => {
    const progress = new Animated.Value(2);
    const normalizedProgress = Animated.divide(
      Animated.subtract(2, progress),
      2
    );
    const sourcePosition = Animated.add(1, normalizedProgress);
    const targetPosition = normalizedProgress;

    act(() => {
      renderer = create(
        <>
          <PagerItem
            position={sourcePosition}
            isLayoutOwner={false}
            containerSize={100}
            vertical
            animationType="slide"
            activityState={ActivityState.PARTIAL_ACTIVE}
            priority={1}
            useNativeScreens
          >
            <View testID="reverse-source" />
          </PagerItem>
          <PagerItem
            position={targetPosition}
            isLayoutOwner
            containerSize={100}
            vertical
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
            priority={2}
            useNativeScreens
          >
            <View testID="reverse-target" />
          </PagerItem>
        </>
      );
    });

    const source = getScreen(renderer, 'reverse-source');
    const target = getScreen(renderer, 'reverse-target');
    expect(readPositionStyle(source)).toBe('absolute');
    expect(readPositionStyle(target)).toBeUndefined();
    expect(readTranslation(source, 'translateY')).toBe(0);
    expect(readTranslation(target, 'translateY')).toBe(-100);

    act(() => progress.setValue(1));
    expect(readTranslation(source, 'translateY')).toBe(50);
    expect(readTranslation(target, 'translateY')).toBe(-50);

    act(() => progress.setValue(0));
    expect(readTranslation(source, 'translateY')).toBe(100);
    expect(readTranslation(target, 'translateY')).toBe(0);
  });
  it('omits the page size until the container has been measured', () => {
    act(() => {
      renderer = create(
        <>
          <PagerItem
            position={1}
            isLayoutOwner
            containerSize={0}
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
            priority={2}
            useNativeScreens
          >
            <View testID="unmeasured" />
          </PagerItem>
          <PagerItem
            position={1}
            isLayoutOwner
            containerSize={100}
            animationType="slide"
            activityState={ActivityState.FULL_ACTIVE}
            priority={2}
            useNativeScreens
          >
            <View testID="measured" />
          </PagerItem>
        </>
      );
    });

    const unmeasured = StyleSheet.flatten(
      getScreen(renderer, 'unmeasured').props.style
    ) as ViewStyle;
    const measured = StyleSheet.flatten(
      getScreen(renderer, 'measured').props.style
    ) as ViewStyle;

    expect(unmeasured.width).toBeUndefined();
    expect(measured.width).toBe(100);
  });

  it('wraps native page content in a non-collapsable view that a freeze hides', () => {
    jest.useFakeTimers();
    const page = createCountingPage();

    act(() => {
      renderer = create(page.render(ActivityState.FULL_ACTIVE));
    });

    const screen = renderer.toJSON() as ReactTestRendererJSON;
    expect(screen.type).toBe('NativeScreen');
    expect(screen.children).toHaveLength(1);
    const wrapper = screen.children![0] as ReactTestRendererJSON;
    expect(wrapper.type).toBe('View');
    expect(wrapper.props.collapsable).toBe(false);
    expect(StyleSheet.flatten(wrapper.props.style)).toEqual({ flex: 1 });
    expect(
      wrapper.children?.map(
        (child) => (child as ReactTestRendererJSON).props.testID
      )
    ).toEqual(['counting']);

    // Freezing hides the wrapper itself rather than what is inside it.
    update(page.render(ActivityState.INACTIVE));
    advance(FREEZE_DELAY);
    expect((renderer.toJSON() as ReactTestRendererJSON).children).toBeNull();
  });

  it('leaves view render mode content unwrapped', () => {
    act(() => {
      renderer = create(
        <PagerItem
          position={1}
          isLayoutOwner
          containerSize={100}
          animationType="slide"
          activityState={ActivityState.FULL_ACTIVE}
          priority={2}
          useNativeScreens={false}
        >
          <View testID="view-mode" />
        </PagerItem>
      );
    });

    const page = renderer.toJSON() as ReactTestRendererJSON;
    expect(
      page.children?.map(
        (child) => (child as ReactTestRendererJSON).props.testID
      )
    ).toEqual(['view-mode']);
  });
});
