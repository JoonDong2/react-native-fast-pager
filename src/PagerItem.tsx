import { isValidElement, memo, useEffect, useMemo, useState } from 'react';
import { Animated } from 'react-native';
import { Screen } from 'react-native-screens';
import { Freeze } from 'react-freeze';
import { ActivityState, type PagerItemProps } from './types';
import { styles } from './styles';

const AnimatedScreen = Animated.createAnimatedComponent(Screen);

export const PagerItem = memo(
  ({
    children,
    position,
    isLayoutOwner,
    animationType,
    activityState,
    priority,
    vertical,
    containerSize,
    useNativeScreens = true,
    freeze = false,
    freezeDelay = 1000,
  }: PagerItemProps) => {
    const diff = useMemo(() => Animated.subtract(position, 1), [position]);

    const animatedStyle = useMemo(() => {
      if (animationType === 'none') return {};

      const style:
        | {
            opacity?: Animated.AnimatedInterpolation<number>;
            transform?: {
              translateX: Animated.AnimatedInterpolation<number>;
            }[];
          }
        | {
            opacity?: Animated.AnimatedInterpolation<number>;
            transform?: {
              translateY: Animated.AnimatedInterpolation<number>;
            }[];
          } = {};

      if (animationType === 'fade' || animationType === 'fade-slide') {
        style.opacity = diff.interpolate({
          inputRange: [-1, -0.5, 0, 0.5, 1],
          outputRange: [0, 0.5, 1, 0.5, 0],
          extrapolate: 'clamp',
        });
      }

      if (animationType === 'slide' || animationType === 'fade-slide') {
        const translate = Animated.multiply(diff, containerSize);
        if (vertical) {
          style.transform = [{ translateY: translate }];
        } else {
          style.transform = [{ translateX: translate }];
        }
      }

      return style;
    }, [animationType, diff, containerSize, vertical]);

    // containerSize is 0 until the container reports its first onLayout.
    // Pinning pages to that size lays their content out at width (or height) 0,
    // and children that cache a measurement then keep the wrong one. Leave the
    // size off until it is known so pages stretch to the container instead.
    const containerStyle =
      containerSize > 0
        ? {
            zIndex: priority,
            [vertical ? 'height' : 'width']: containerSize,
          }
        : { zIndex: priority };

    const commonStyle = [
      !isLayoutOwner && styles.inactiveItem,
      animatedStyle,
      styles.itemContainer,
      containerStyle,
    ];

    const childContent = isValidElement(children)
      ? children
      : children({ activityState, priority, diff });

    // Freeze only fully inactive pages. react-freeze hides frozen subtrees
    // via Suspense (display: none), so freezing PARTIAL_ACTIVE pages would
    // hide swipe previews and transition targets while they are moving.
    const wantsFreeze = freeze && activityState === ActivityState.INACTIVE;

    // react-freeze suspends before it renders its children, so a page frozen
    // on its very first render never mounts at all. Freezing is meant to stop
    // a page that exists, not to keep one from existing: lazy mounting only
    // renders a page once it should mount, but lazy={false} renders every page
    // while all but the current one are INACTIVE, and freezing those from
    // birth would leave them unmounted for good. Such a page renders its
    // content once before it can be frozen - and it waits for the container
    // to be measured, so it still never lays out at a size that has not
    // settled.
    const [hasRenderedContent, setHasRenderedContent] = useState(!wantsFreeze);

    // Once it has rendered, a page is frozen only after it has stayed inactive
    // for freezeDelay, so switching back and forth faster than that does not
    // freeze and unfreeze it on every move. A page that comes back unfreezes
    // in the same render, which also clears the elapsed flag so the next
    // departure waits out the whole delay again; clearing it in an effect
    // instead would re-render the page as its transition starts.
    const [freezeDelayElapsed, setFreezeDelayElapsed] = useState(false);
    if (freezeDelayElapsed && !wantsFreeze) {
      setFreezeDelayElapsed(false);
    }

    const shouldFreeze =
      wantsFreeze &&
      (hasRenderedContent ? freezeDelayElapsed : containerSize === 0);

    useEffect(() => {
      if (shouldFreeze || hasRenderedContent) return;
      setHasRenderedContent(true);
    }, [shouldFreeze, hasRenderedContent]);

    const waitingToFreeze =
      wantsFreeze && hasRenderedContent && !freezeDelayElapsed;

    useEffect(() => {
      if (!waitingToFreeze) return;
      const timer = setTimeout(() => setFreezeDelayElapsed(true), freezeDelay);
      return () => clearTimeout(timer);
    }, [waitingToFreeze, freezeDelay]);

    if (useNativeScreens) {
      return (
        <AnimatedScreen
          // react-native-screens applies its own freeze one tick after being
          // asked to, which lets a page that has never been shown render and
          // lay out once at a container size that has not settled yet. Turn it
          // off and freeze the content directly, the same way view render mode
          // does, so a page first lays out when it is shown.
          shouldFreeze={false}
          activityState={activityState}
          style={commonStyle}
          pointerEvents={
            activityState === ActivityState.FULL_ACTIVE ? 'auto' : 'none'
          }
        >
          <Freeze freeze={shouldFreeze}>{childContent}</Freeze>
        </AnimatedScreen>
      );
    }

    return (
      <Freeze freeze={shouldFreeze}>
        <Animated.View
          style={commonStyle}
          pointerEvents={activityState === 2 ? 'auto' : 'none'}
        >
          {childContent}
        </Animated.View>
      </Freeze>
    );
  }
);
