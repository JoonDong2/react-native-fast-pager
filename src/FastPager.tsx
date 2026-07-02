import { Component } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import type { LayoutChangeEvent, PanResponderInstance } from 'react-native';
import { ScreenContainer } from 'react-native-screens';
import { PagerItem } from './PagerItem';
import {
  SWIPE_THRESHOLD,
  VELOCITY_THRESHOLD,
  CONTINUOUS_PRELOAD_THRESHOLD,
  INITIAL_PRELOAD_THRESHOLD,
} from './constants';
import { styles } from './styles';
import type { FastPagerProps, FastPagerState } from './types';

class FastPager extends Component<FastPagerProps, FastPagerState> {
  private internalAnimatedIndex: Animated.Value;
  private currentIndex: number; // Logical current index (equivalent to useRef in hooks)
  private itemOffsets: Record<number, Animated.Value> = {};
  private animationInstance: ReturnType<typeof Animated.spring> | null = null;
  private panResponder: PanResponderInstance;
  private isUnmounted = false;

  static defaultProps = {
    renderMode: 'native',
    index: 0,
    swipeEnabled: true,
    animationType: 'slide',
    direction: 'horizontal',
  };

  constructor(props: FastPagerProps) {
    super(props);

    const initialIndex = props.index ?? 0;
    this.currentIndex = initialIndex;

    // Sync initial value: if an external animatedIndex is provided, force-set it to the current index to prevent snapping to 0
    if (props.animatedIndex) {
      props.animatedIndex.setValue(initialIndex);
      this.internalAnimatedIndex = props.animatedIndex;
    } else {
      this.internalAnimatedIndex = new Animated.Value(initialIndex);
    }

    this.state = {
      activeIndex: initialIndex,
      mountedIndices: new Set([initialIndex]),
      swipingToIndex: null,
      isAnimating: false,
      departingIndex: null,
      transitionTarget: null,
      layout: { width: 0, height: 0 },
    };

    this.panResponder = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        if (!this.props.swipeEnabled) return false;

        const delta = this.props.vertical ? gestureState.dy : gestureState.dx;
        const absDelta = Math.abs(delta);
        const dx = Math.abs(gestureState.dx);
        const dy = Math.abs(gestureState.dy);

        const isValidSwipe = this.props.vertical
          ? dy > dx && absDelta > 10
          : dx > dy && absDelta > 10;

        if (!isValidSwipe) return false;

        // Stop animation (without triggering unmount)
        if (this.animationInstance) {
          this.animationInstance.stop();
          this.animationInstance = null;
        }
        // Reset offsets at gesture start
        this.resetAllOffsets();

        const childCount = this.props.children.length;
        const currentIdx = this.currentIndex;

        const isSwipingPrev = delta > 0; // Down or Right
        const isSwipingNext = delta < 0; // Up or Left

        // Boundary check
        if (isSwipingNext && currentIdx >= childCount - 1) return false;
        if (isSwipingPrev && currentIdx <= 0) return false;

        return true;
      },

      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: () => {
        this.setState({
          isAnimating: true,
          swipingToIndex: null,
        });
        this.props.onSwipeStart?.();
      },

      onPanResponderMove: (_, gestureState) => {
        const currentIdx = this.currentIndex;
        const containerSize = this.getCurrentContainerSize();
        if (containerSize === 0) return;

        const delta = this.props.vertical ? gestureState.dy : gestureState.dx;
        const offset = -delta / containerSize;

        const newProgress = currentIdx + offset;
        const childCount = this.props.children.length;

        const clampedValue = Math.max(
          -0.2,
          Math.min(childCount - 1 + 0.2, newProgress)
        );

        this.getAnimatedIndex().setValue(clampedValue);

        // [Lazy Loading] Pre-mount target
        const targetIdx = offset > 0 ? currentIdx + 1 : currentIdx - 1;

        if (targetIdx >= 0 && targetIdx < childCount) {
          // [Optimization] Class member access guarantees latest values (equivalent to useRef)
          const { mountedIndices, swipingToIndex } = this.state;

          const hasBeenMounted = mountedIndices.has(targetIdx);
          // First mount uses INITIAL_PRELOAD_THRESHOLD,
          // previously mounted screens use CONTINUOUS_PRELOAD_THRESHOLD
          const threshold = hasBeenMounted
            ? CONTINUOUS_PRELOAD_THRESHOLD
            : INITIAL_PRELOAD_THRESHOLD;

          if (Math.abs(offset) > threshold) {
            if (!hasBeenMounted) {
              this.ensureMounted(targetIdx);
            } else if (swipingToIndex !== targetIdx) {
              this.setState({ swipingToIndex: targetIdx });
            }
          }
        }
      },

      onPanResponderRelease: (_, gestureState) => {
        const currentIdx = this.currentIndex;
        const containerSize = this.getCurrentContainerSize();
        if (containerSize === 0) {
          this.setState({
            isAnimating: false,
            swipingToIndex: null,
            transitionTarget: null,
          });
          return;
        }

        const delta = this.props.vertical ? gestureState.dy : gestureState.dx;
        const velocityValue = this.props.vertical
          ? gestureState.vy
          : gestureState.vx;

        const offset = -delta / containerSize;
        const velocity = -velocityValue;
        const childCount = this.props.children.length;

        let targetIdx = currentIdx;
        const canGoNext = currentIdx < childCount - 1;
        const canGoPrev = currentIdx > 0;

        if (
          canGoNext &&
          (velocity > VELOCITY_THRESHOLD || offset > SWIPE_THRESHOLD)
        ) {
          targetIdx = currentIdx + 1;
        } else if (
          canGoPrev &&
          (velocity < -VELOCITY_THRESHOLD || offset < -SWIPE_THRESHOLD)
        ) {
          targetIdx = currentIdx - 1;
        }

        this.currentIndex = targetIdx;

        // [Aborted Swipe] When snapping back below the threshold, keep the
        // previewed screen attached (activityState 1) as a departing screen so
        // react-native-screens detaches it only after the snap-back animation
        // finishes (renderMode='native'), instead of disappearing instantly.
        const previewIndex = this.state.swipingToIndex;
        const departingIndex =
          targetIdx === currentIdx &&
          previewIndex !== null &&
          previewIndex !== targetIdx
            ? previewIndex
            : this.state.departingIndex;

        this.setState(
          {
            transitionTarget: targetIdx,
            swipingToIndex: null,
            departingIndex,
          },
          () => {
            if (targetIdx !== currentIdx) {
              this.ensureMounted(targetIdx);
              this.props.onIndexChange?.(targetIdx);
            }
            // Pass current (previous) index as fromIndex to track departing screen
            this.runAnimation(targetIdx, Math.abs(velocity), currentIdx);
          }
        );
      },

      onPanResponderTerminate: () => {
        const currentIdx = this.currentIndex;
        // [Aborted Swipe] Same as onPanResponderRelease: keep the previewed
        // screen attached until the snap-back animation finishes.
        const previewIndex = this.state.swipingToIndex;
        this.setState(
          {
            transitionTarget: currentIdx,
            swipingToIndex: null,
            departingIndex:
              previewIndex !== null && previewIndex !== currentIdx
                ? previewIndex
                : this.state.departingIndex,
          },
          () => {
            this.runAnimation(currentIdx);
          }
        );
      },
    });
  }

  getAnimatedIndex = (): Animated.Value => {
    return this.props.animatedIndex ?? this.internalAnimatedIndex;
  };

  getCurrentContainerSize = (): number => {
    const { vertical, layout: layoutProps } = this.props;
    const { layout } = this.state;
    if (vertical) {
      return layoutProps?.height ?? layout.height;
    }
    return layoutProps?.width ?? layout.width;
  };

  componentWillUnmount() {
    this.isUnmounted = true;
    if (this.animationInstance) {
      this.animationInstance.stop();
      this.animationInstance = null;
    }
  }

  componentDidUpdate(prevProps: FastPagerProps) {
    // Handle external animatedIndex instance swap
    if (prevProps.animatedIndex !== this.props.animatedIndex) {
      if (this.animationInstance) {
        this.animationInstance.stop();
        this.animationInstance = null;
      }
      // If the external prop was removed, reset internal fallback to a fresh value
      if (!this.props.animatedIndex) {
        this.internalAnimatedIndex = new Animated.Value(this.currentIndex);
      }
      this.getAnimatedIndex().setValue(this.currentIndex);
    }

    const prevIndex = prevProps.index ?? 0;
    const nextIndex = this.props.index ?? 0;

    // When the external index prop changes
    if (prevIndex !== nextIndex) {
      // Resolve race condition during swipe:
      // If we've already reached nextIndex internally (e.g. via swipe),
      // skip the forced navigation from the prop update
      if (this.currentIndex === nextIndex) {
        this.ensureMounted(nextIndex);
        return;
      }

      // --- Forced navigation logic (e.g. button press) ---

      if (this.animationInstance) {
        this.animationInstance.stop();
        this.animationInstance = null;
      }

      // [Important] Update ref (this.currentIndex) on external change
      this.currentIndex = nextIndex;

      // Mount handling
      this.ensureMounted(nextIndex); // 1. Mount the destination screen
      this.ensureMounted(prevIndex); // 2. Keep the departing screen mounted

      // [Adjacent correction logic]
      // When index difference > 1 (e.g. 0 -> 3),
      // skip intermediate steps and animate as if transitioning from the adjacent screen
      const diff = nextIndex - prevIndex;

      if (Math.abs(diff) > 1) {
        // Calculate movement direction
        const direction = diff > 0 ? 1 : -1;

        // Virtual start index for the animation
        // e.g. if target is 3 and direction is +1, pretend we start from 2
        const virtualStartIndex = nextIndex - direction;

        this.resetAllOffsets();

        // 1. Adjust departing screen (prevIndex)
        // Position the departing screen at the visual center (0) relative to virtualStartIndex
        // Formula: (prevIndex + offset) - virtualStartIndex = 0
        const departingOffset = virtualStartIndex - prevIndex;
        this.getItemOffset(prevIndex).setValue(departingOffset);

        // 2. Adjust entering screen (nextIndex)
        // The entering screen uses its natural position, so offset is 0
        // Formula: (nextIndex + 0) - virtualStartIndex = direction (1 or -1)
        // This holds since nextIndex - (nextIndex - direction) = direction, no extra offset needed
        this.getItemOffset(nextIndex).setValue(0);

        // 3. Force-set the animated value
        this.getAnimatedIndex().setValue(virtualStartIndex);

        // 4. Run animation (virtualStartIndex -> nextIndex)
        // Visually appears as a single-step transition
        this.animateToIndex(nextIndex, true, prevIndex);
      } else {
        // Standard adjacent transition (e.g. 0 -> 1)
        this.resetAllOffsets();
        this.getAnimatedIndex().setValue(prevIndex);
        this.animateToIndex(nextIndex, true, prevIndex);
      }
    }

    // [Cleanup Effect]
    // Runs after animation ends and activeIndex is updated,
    // deferring the departing screen's deactivation to the next render cycle.
    if (!this.state.isAnimating && this.state.departingIndex !== null) {
      this.setState({ departingIndex: null }, () => {
        // Final cleanup after animation completion
        this.pruneMountedIndices(this.state.activeIndex);
        this.props.onSwipeEnd?.(this.state.activeIndex);
      });
    }
  }

  // --- 1. Mount Logic (Add Only) ---
  // This function only adds indices and never removes them.
  ensureMounted = (idx: number) => {
    this.setState((prevState) => {
      // [Modified] During animation, preserve order by not re-inserting existing indices
      // (skipping delete -> add reordering)
      if (prevState.mountedIndices.has(idx)) {
        return null; // No state change
      }
      // Add to end of Set (newest = lowest priority)
      const newSet = new Set(prevState.mountedIndices);
      newSet.add(idx);
      return { mountedIndices: newSet };
    });
  };

  // --- 2. Prune Logic (Remove & Reorder) ---
  // This function handles removal and reordering after animation completes.
  pruneMountedIndices = (targetIndex: number) => {
    const isInfiniteKeepAlive = this.props.keepAlive === undefined;
    const keepAliveLimit = this.props.keepAlive ?? Number.MAX_SAFE_INTEGER;

    let nextKeptSet: Set<number> | null = null;

    this.setState(
      (prevState) => {
        const newSet = new Set(prevState.mountedIndices);

        // Animation complete: move target to end of Set
        // to mark it as the newest (lowest priority / active)
        if (newSet.has(targetIndex)) {
          newSet.delete(targetIndex);
        }
        newSet.add(targetIndex);

        if (isInfiniteKeepAlive) return { mountedIndices: newSet };
        if (newSet.size <= keepAliveLimit) return { mountedIndices: newSet };

        // FIFO eviction: keep the newest entries (from the end)
        const toKeep = Array.from(newSet).slice(newSet.size - keepAliveLimit);

        // [Safety] Force-add targetIndex if missing
        if (!toKeep.includes(targetIndex)) {
          toKeep.push(targetIndex);
        }

        const keptSet = new Set(toKeep);
        nextKeptSet = keptSet;
        return { mountedIndices: keptSet };
      },
      () => {
        // Side effects run after commit (safe under strict mode double-invocation)
        if (!nextKeptSet) return;
        Object.keys(this.itemOffsets).forEach((key) => {
          const k = Number(key);
          if (!nextKeptSet!.has(k)) {
            delete this.itemOffsets[k];
          }
        });
      }
    );
  };

  getItemOffset = (idx: number) => {
    if (!this.itemOffsets[idx]) {
      this.itemOffsets[idx] = new Animated.Value(0);
    }
    return this.itemOffsets[idx];
  };

  resetAllOffsets = () => {
    Object.values(this.itemOffsets).forEach((offset) => offset.setValue(0));
  };

  // --- Animation Logic ---
  runAnimation = (
    targetIndex: number,
    velocity?: number,
    fromIndex?: number
  ) => {
    if (this.animationInstance) {
      this.animationInstance.stop();
    }

    // Record the departing index (use fromIndex if provided, otherwise activeIndex)
    const departing =
      fromIndex !== undefined ? fromIndex : this.state.activeIndex;
    if (departing !== targetIndex) {
      this.setState({ departingIndex: departing });
    }

    const anim = Animated.spring(this.getAnimatedIndex(), {
      toValue: targetIndex,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
      velocity: velocity,
    });

    this.animationInstance = anim;

    anim.start(({ finished }) => {
      // [Modification] Only clean up when finished is true
      // Ignore stale target if an external prop change occurred mid-animation
      if (finished && !this.isUnmounted && targetIndex === this.currentIndex) {
        this.resetAllOffsets();
        this.setState({
          transitionTarget: null,
          activeIndex: targetIndex,
          isAnimating: false,
        });
      }
    });
  };

  animateToIndex = (
    targetIndex: number,
    animated: boolean,
    fromIndex?: number
  ) => {
    this.setState(
      {
        transitionTarget: targetIndex,
        swipingToIndex: null,
        isAnimating: true,
      },
      () => {
        if (!animated || this.props.animationType === 'none') {
          this.resetAllOffsets();
          this.getAnimatedIndex().setValue(targetIndex);
          this.setState(
            {
              transitionTarget: null,
              activeIndex: targetIndex,
              isAnimating: false,
              departingIndex: null, // Clear immediately when not animated
            },
            () => {
              // Clean up immediately when not animated
              this.pruneMountedIndices(targetIndex);
            }
          );
          return;
        }
        this.runAnimation(targetIndex, undefined, fromIndex);
      }
    );
  };

  public goTo = (targetIndex: number, animated = true) => {
    const childCount = this.props.children.length;
    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= childCount
    ) {
      return;
    }
    if (targetIndex !== this.currentIndex) {
      if (this.animationInstance) this.animationInstance.stop();
      const prevIndex = this.currentIndex;
      this.currentIndex = targetIndex;

      this.ensureMounted(targetIndex); // Mount destination
      this.ensureMounted(prevIndex); // Keep departing screen mounted

      // Note: goTo should ideally share the jump offset logic with componentDidUpdate
      // for non-adjacent transitions, but since goTo is typically used as an internal method,
      // we call animateToIndex directly here.
      // For full jump handling, prefer changing the index prop externally.
      this.animateToIndex(targetIndex, animated, prevIndex);
      this.props.onIndexChange?.(targetIndex);
    }
  };

  getActivityState = (itemIndex: number): 0 | 1 | 2 => {
    // Only activate indices that are explicitly participating in the current interaction (state 1 or 2)
    const {
      activeIndex,
      transitionTarget,
      swipingToIndex,
      departingIndex,
      isAnimating,
    } = this.state;

    const isSource = itemIndex === activeIndex; // Currently displayed screen
    const isTarget =
      transitionTarget !== null && itemIndex === transitionTarget; // Transition target
    const isSwiping = swipingToIndex !== null && itemIndex === swipingToIndex; // Gesture preview
    const isDeparting = departingIndex !== null && itemIndex === departingIndex; // Departing afterimage

    // 1. When not animating/interacting
    if (!isAnimating) {
      if (isSource) return 2;
      if (isDeparting) return 1; // Keep at 1 while departing (until cleanup in next render)
      return 0;
    }

    // 2. During animation (participant-based logic)
    if (isSource) return 2; // Source always stays fully active
    if (isTarget || isSwiping || isDeparting) return 1; // Target and related screens are partially active

    // All others (including intermediate screens) are inactive
    return 0;
  };

  // --- Render Indices Calculation ---
  getRenderIndices = () => {
    const { mountedIndices, transitionTarget, swipingToIndex, activeIndex } =
      this.state;
    const { index, children } = this.props;
    const childCount = children.length;

    // 1. All currently mounted indices (added via ensureMounted)
    const combinedIndices = new Set(mountedIndices);

    // 2. [Required] Current props index (ensures external control responsiveness)
    if (index !== undefined) combinedIndices.add(index);
    // 3. [Required] Current physical position (replaces currentIndexRef) - ensures animation start point
    combinedIndices.add(this.currentIndex);
    // 4. [Required] Animation target
    if (transitionTarget !== null) combinedIndices.add(transitionTarget);
    // 5. [Required] Swipe preview target
    if (swipingToIndex !== null) combinedIndices.add(swipingToIndex);
    // 6. [Required] Currently active screen (ensures departing screen afterimage)
    combinedIndices.add(activeIndex);

    // Validate and sort
    return Array.from(combinedIndices)
      .filter((i) => i >= 0 && i < childCount)
      .sort((a, b) => a - b);
  };

  handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const { layout: layoutProps, vertical } = this.props;

    const isControlled = vertical
      ? layoutProps?.height !== undefined
      : layoutProps?.width !== undefined;

    if (
      !isControlled &&
      (this.state.layout.width !== width || this.state.layout.height !== height)
    ) {
      this.setState({ layout: { width, height } });
    }
    this.props.onLayout?.(e);
  };

  render() {
    const {
      children,
      renderMode: mode,
      style,
      animationType,
      vertical,
      freeze = true,
    } = this.props;

    const { mountedIndices, activeIndex } = this.state;
    const containerSize = this.getCurrentContainerSize();
    const renderIndices = this.getRenderIndices();

    // Compute mount order: convert mountedIndices (Set) to array
    // Since ensureMounted appends via 'delete -> add', later entries are newest
    const mountedOrderArray = Array.from(mountedIndices);
    const animatedIndex = this.getAnimatedIndex();

    const useNativeScreens = mode === 'native';
    const Container = useNativeScreens ? ScreenContainer : View;
    const containerProps = useNativeScreens ? { enabled: true } : {};

    return (
      <Container
        onLayout={this.handleLayout}
        {...containerProps}
        style={[styles.container, style]}
        {...(this.props.swipeEnabled !== false
          ? this.panResponder.panHandlers
          : undefined)}
      >
        {renderIndices
          .filter((i) => children[i] != null)
          .map((i) => {
            // Priority calculation logic
            // mountedOrderArray: [oldest, ..., newest]
            // Only show up to 2: the most recently activated child and the one before it get high zIndex
            const orderIndex = mountedOrderArray.indexOf(i);
            const len = mountedOrderArray.length;

            let priority: number;
            if (orderIndex === -1) {
              priority = 0;
            } else if (orderIndex === len - 1) {
              priority = 2; // Most recently activated -> highest zIndex
            } else if (orderIndex === len - 2) {
              priority = 1; // Previously activated -> second zIndex
            } else {
              priority = 0; // All others -> lowest
            }

            // Check if this child has never been mounted
            const isUnmounted = !mountedIndices.has(i);
            // If swipeEnabled and never mounted, disable freeze to allow initial render
            const itemFreeze =
              this.props.swipeEnabled !== false && isUnmounted ? false : freeze;

            return (
              <PagerItem
                key={i}
                itemIndex={i}
                animatedIndex={animatedIndex}
                activityState={this.getActivityState(i)}
                containerSize={containerSize}
                vertical={vertical}
                isActive={i === activeIndex}
                offset={this.getItemOffset(i)}
                animationType={animationType || 'slide'}
                priority={priority}
                useNativeScreens={useNativeScreens}
                freeze={itemFreeze}
              >
                {children[i]!}
              </PagerItem>
            );
          })}
      </Container>
    );
  }
}

export default FastPager;
