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

    const containerStyle = {
      zIndex: priority,
      [vertical ? 'height' : 'width']: containerSize,
    };

    const commonStyle = [
      styles.inactiveItem,
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
          shouldFreeze={shouldFreeze}
          activityState={activityState}
          style={commonStyle}
          pointerEvents={
            activityState === ActivityState.FULL_ACTIVE ? 'auto' : 'none'
          }
        >
          {childContent}
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
