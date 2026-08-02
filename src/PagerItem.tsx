import { isValidElement, memo, useMemo } from 'react';
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
    freeze = true,
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
    const shouldFreeze = freeze && activityState === ActivityState.INACTIVE;

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
