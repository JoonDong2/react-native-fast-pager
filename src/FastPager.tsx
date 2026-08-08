import { Component } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import type {
  LayoutChangeEvent,
  PanResponderGestureState,
  PanResponderInstance,
} from 'react-native';
import { ScreenContainer } from 'react-native-screens';
import { PagerItem } from './PagerItem';
import {
  SWIPE_THRESHOLD,
  VELOCITY_THRESHOLD,
  CONTINUOUS_PRELOAD_THRESHOLD,
  INITIAL_PRELOAD_THRESHOLD,
  DIRECTION_THRESHOLD,
} from './constants';
import { styles } from './styles';
import { ActivityState } from './types';
import type {
  FastPagerProgressChangeEvent,
  FastPagerProps,
  FastPagerState,
} from './types';

// Animated.event(..., { useNativeDriver: true }) returns an AnimatedEvent
// object instead of a handler function. When its mapping is the documented
// { nativeEvent: { progress } } shape, the pager adopts the mapped value and
// drives it directly with its native-driver animations, so transition frames
// never round-trip through JS. Other object mappings fall back to a JS
// emitter that replicates RN's JS-driver mapping; plain functions (including
// useNativeDriver: false handlers) are simply called with the event.
type AnimatedEventObject = {
  _argMapping?: unknown[];
  _listeners?: unknown[];
  __getHandler?: () => (...args: unknown[]) => void;
};

type ProgressBinding = {
  source: NonNullable<FastPagerProps['onProgressChange']>;
} & (
  | { kind: 'emit'; emit: (event: FastPagerProgressChangeEvent) => void }
  | {
      kind: 'adopt';
      value: Animated.Value;
      emitListeners: ((event: FastPagerProgressChangeEvent) => void) | null;
    }
);

const extractMappedProgressValue = (
  animatedEvent: AnimatedEventObject
): Animated.Value | null => {
  const firstMapping = Array.isArray(animatedEvent._argMapping)
    ? (animatedEvent._argMapping[0] as
        | { nativeEvent?: { progress?: unknown } }
        | undefined)
    : undefined;
  const mappedProgress = firstMapping?.nativeEvent?.progress;
  return mappedProgress instanceof Animated.Value ? mappedProgress : null;
};

const drivenValueForHandler = (
  handler: FastPagerProps['onProgressChange'],
  fallback: Animated.Value
): Animated.Value => {
  if (!handler || typeof handler === 'function') return fallback;
  return extractMappedProgressValue(handler as AnimatedEventObject) ?? fallback;
};

const mapEventToAnimatedValues = (mapping: unknown, value: unknown) => {
  if (mapping instanceof Animated.Value) {
    if (typeof value === 'number') {
      mapping.setValue(value);
    }
    return;
  }
  if (
    mapping !== null &&
    typeof mapping === 'object' &&
    value !== null &&
    typeof value === 'object'
  ) {
    for (const key of Object.keys(mapping)) {
      mapEventToAnimatedValues(
        (mapping as Record<string, unknown>)[key],
        (value as Record<string, unknown>)[key]
      );
    }
  }
};

const createAnimatedEventEmitter = (animatedEvent: AnimatedEventObject) => {
  const argMapping = Array.isArray(animatedEvent._argMapping)
    ? animatedEvent._argMapping
    : null;
  const callListeners =
    typeof animatedEvent.__getHandler === 'function'
      ? animatedEvent.__getHandler()
      : null;

  if (__DEV__ && !argMapping) {
    console.warn(
      'FastPager: onProgressChange expects a function or an Animated.event mapping, but received an object without _argMapping.'
    );
  }

  return (event: FastPagerProgressChangeEvent) => {
    if (argMapping) {
      // The event is always the first (and only) emitted argument
      mapEventToAnimatedValues(argMapping[0], event);
    }
    callListeners?.(event);
  };
};

const createProgressBinding = (
  handler: NonNullable<FastPagerProps['onProgressChange']>
): ProgressBinding => {
  if (typeof handler === 'function') {
    return { source: handler, kind: 'emit', emit: handler };
  }

  const animatedEvent = handler as AnimatedEventObject;
  const value = extractMappedProgressValue(animatedEvent);
  if (!value) {
    return {
      source: handler,
      kind: 'emit',
      emit: createAnimatedEventEmitter(animatedEvent),
    };
  }

  // Listeners are the only part of an adopted Animated.event that still needs
  // the JS thread; skip them entirely when none were configured.
  const emitListeners =
    Array.isArray(animatedEvent._listeners) &&
    animatedEvent._listeners.length > 0 &&
    typeof animatedEvent.__getHandler === 'function'
      ? animatedEvent.__getHandler()
      : null;

  return { source: handler, kind: 'adopt', value, emitListeners };
};

class FastPager extends Component<FastPagerProps, FastPagerState> {
  private internalProgress: Animated.Value;
  private progressBinding: ProgressBinding | null = null;
  private attachedProgressListener: {
    value: Animated.Value;
    id: string;
  } | null = null;
  private lastProgressValue: number;
  private currentIndex: number; // Logical current index (equivalent to useRef in hooks)
  private animationInstance: ReturnType<typeof Animated.spring> | null = null;
  private panResponder: PanResponderInstance;
  // Imperative moves are reported after arrival; gesture moves are reported
  // as soon as release selects their destination.
  private pendingIndexChange: number | null = null;
  // Self-navigated indices reported via onIndexChange that a controlled
  // parent has not rendered back into the index prop yet. A late prop change
  // matching one of these is an acknowledgement, not a navigation command.
  private reportedIndexQueue: number[] = [];
  // True between onPanResponderGrant and the gesture's release/terminate.
  private activePanGesture = false;
  // Set when an external index change takes over mid-gesture; the remainder
  // of that gesture must not drive progress or settle.
  private panGestureOverridden = false;
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
    this.lastProgressValue = initialIndex;
    this.internalProgress = new Animated.Value(initialIndex);

    // Seed an adopted Animated.event value so it does not snap from a stale
    // position on the first transition
    const binding = this.resolveProgressBinding();
    if (binding?.kind === 'adopt') {
      binding.value.setValue(initialIndex);
    }

    this.state = {
      activeIndex: initialIndex,
      mountedIndices:
        props.keepAlive === undefined
          ? new Set(props.children.map((_, index) => index))
          : new Set([initialIndex]),
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
          ? dy > dx && absDelta > DIRECTION_THRESHOLD
          : dx > dy && absDelta > DIRECTION_THRESHOLD;

        if (!isValidSwipe) return false;

        // Stop animation (without triggering unmount)
        if (this.animationInstance) {
          this.animationInstance.stop();
          this.animationInstance = null;
        }
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
        this.activePanGesture = true;
        this.panGestureOverridden = false;
        this.setState({
          isAnimating: true,
          swipingToIndex: null,
        });
        this.props.onSwipeStart?.();
      },

      onPanResponderMove: (_, gestureState) => {
        if (this.panGestureOverridden) return;
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

        this.getProgress().setValue(clampedValue);

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
            if (!hasBeenMounted || swipingToIndex !== targetIdx) {
              this.setState((prevState) => {
                const nextMountedIndices = new Set(prevState.mountedIndices);
                nextMountedIndices.add(targetIdx);
                return {
                  mountedIndices: nextMountedIndices,
                  swipingToIndex: targetIdx,
                };
              });
            }
          }
        }
      },

      onPanResponderRelease: (_, gestureState) => {
        this.settlePan(gestureState);
      },

      // Termination is not a finger-up. A native parent can take the responder
      // while the touch is still down, so committing by offset/velocity here
      // would advance the page before the user releases the gesture.
      onPanResponderTerminate: () => {
        this.cancelPan();
      },
    });
  }

  cancelPan = () => {
    const wasOverridden = this.panGestureOverridden;
    this.activePanGesture = false;
    this.panGestureOverridden = false;
    // An external index change already owns the transition.
    if (wasOverridden) return;

    const currentIdx = this.currentIndex;
    const previewIndex = this.state.swipingToIndex;
    const departingIndex =
      previewIndex !== null && previewIndex !== currentIdx
        ? previewIndex
        : this.state.departingIndex;

    this.setState(
      {
        transitionTarget: currentIdx,
        swipingToIndex: null,
        departingIndex,
      },
      () => {
        this.runAnimation(currentIdx);
      }
    );
  };

  settlePan = (gestureState: PanResponderGestureState) => {
    const wasOverridden = this.panGestureOverridden;
    this.activePanGesture = false;
    this.panGestureOverridden = false;
    // An external index change already owns the transition; the end of the
    // gesture must not settle on top of it.
    if (wasOverridden) return;
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
          // The user's selection is committed when release chooses the target,
          // even though the visual settle animation is still in progress.
          this.pendingIndexChange = null;
          this.reportIndexChange(targetIdx);
          // The callback may synchronously unmount the pager or command a
          // different index. Do not let the released gesture overwrite it.
          if (this.isUnmounted || this.currentIndex !== targetIdx) return;
        }
        // Pass current (previous) index as fromIndex to track departing screen
        this.runAnimation(targetIdx, Math.abs(velocity), currentIdx);
      }
    );
  };

  resolveProgressBinding = (): ProgressBinding | null => {
    const handler = this.props.onProgressChange;
    if (!handler) return null;
    if (this.progressBinding?.source !== handler) {
      this.progressBinding = createProgressBinding(handler);
    }
    return this.progressBinding;
  };

  getProgress = (): Animated.Value => {
    const binding = this.resolveProgressBinding();
    return binding?.kind === 'adopt' ? binding.value : this.internalProgress;
  };

  public get progress(): Animated.Value {
    return this.getProgress();
  }

  emitProgressChange = (progress: number) => {
    this.lastProgressValue = progress;
    const binding = this.resolveProgressBinding();
    if (!binding) return;

    const event: FastPagerProgressChangeEvent = {
      nativeEvent: {
        progress,
      },
    };

    if (binding.kind === 'emit') {
      binding.emit(event);
    } else {
      // Adopted values are driven directly by the pager's animations; only
      // Animated.event listeners still need a JS callback
      binding.emitListeners?.(event);
    }
  };

  // A per-frame JS listener is only needed when something must actually run
  // on the JS thread: an emit-style handler or Animated.event listeners.
  // Pure adopted bindings keep the transition entirely on the native side.
  syncProgressListener = () => {
    const binding = this.resolveProgressBinding();
    const needsListener =
      binding !== null &&
      (binding.kind === 'emit' || binding.emitListeners !== null);
    const target = needsListener ? this.getProgress() : null;

    if (this.attachedProgressListener?.value === target) return;

    if (this.attachedProgressListener) {
      this.attachedProgressListener.value.removeListener(
        this.attachedProgressListener.id
      );
      this.attachedProgressListener = null;
    }
    if (target) {
      const id = target.addListener(({ value }) => {
        this.emitProgressChange(value);
      });
      this.attachedProgressListener = { value: target, id };
    }
  };

  // A progress value that no native-driver animation has run on yet updates
  // through Animated's JS-driven path during a drag, which applies each frame
  // via Fabric setNativeProps. On Android those per-frame updates are not
  // rendered for react-native-screens Screens, so on the first gesture after
  // mount the pages sit still (only the debounced React commit lands) while
  // plain-View consumers such as tab indicators keep tracking. A zero-duration
  // native-driver timing promotes the value and every attached consumer graph
  // to the native driver, putting the first gesture on the same path every
  // gesture takes after a settle spring has run once.
  warmUpNativeProgress = () => {
    Animated.timing(this.getProgress(), {
      toValue: this.currentIndex,
      duration: 0,
      useNativeDriver: true,
    }).start();
  };

  getCurrentContainerSize = (): number => {
    const { vertical, layout: layoutProps } = this.props;
    const { layout } = this.state;
    if (vertical) {
      return layoutProps?.height ?? layout.height;
    }
    return layoutProps?.width ?? layout.width;
  };

  componentDidMount() {
    this.syncProgressListener();
    this.emitProgressChange(this.currentIndex);
    this.warmUpNativeProgress();
  }

  componentWillUnmount() {
    this.isUnmounted = true;
    if (this.attachedProgressListener) {
      this.attachedProgressListener.value.removeListener(
        this.attachedProgressListener.id
      );
      this.attachedProgressListener = null;
    }
    if (this.animationInstance) {
      this.animationInstance.stop();
      this.animationInstance = null;
    }
  }

  componentDidUpdate(prevProps: FastPagerProps) {
    const prevIndex = prevProps.index ?? 0;
    const nextIndex = this.props.index ?? 0;

    if (prevProps.onProgressChange !== this.props.onProgressChange) {
      const prevDrivenValue = drivenValueForHandler(
        prevProps.onProgressChange,
        this.internalProgress
      );
      const nextDrivenValue = this.getProgress();
      const drivenValueChanged = prevDrivenValue !== nextDrivenValue;

      if (drivenValueChanged) {
        // The driven value itself was swapped: stop any in-flight animation
        // and seat the new value at the current logical position
        if (this.animationInstance) {
          this.animationInstance.stop();
          this.animationInstance = null;
        }
        nextDrivenValue.setValue(this.currentIndex);
        // The swapped-in value may never have been driven natively either.
        this.warmUpNativeProgress();
      }

      this.syncProgressListener();
      // lastProgressValue can be stale for pure adopted bindings (no JS
      // listener), so fall back to the logical index when the value swapped
      this.emitProgressChange(
        drivenValueChanged ? this.currentIndex : this.lastProgressValue
      );
    }

    // When the external index prop changes
    if (prevIndex !== nextIndex) {
      // A controlled parent renders reported indices back with arbitrary
      // delay (onIndexChange -> setState -> render), possibly after the user
      // has navigated further. Such an echo acknowledges an old report;
      // treating it as a command would yank the pager off the page the user
      // is on or hijack a gesture that is still in progress.
      const echoAt = this.reportedIndexQueue.lastIndexOf(nextIndex);
      if (echoAt !== -1) {
        // Everything up to the matched report is superseded by this render.
        this.reportedIndexQueue.splice(0, echoAt + 1);
        if (this.currentIndex === nextIndex) {
          this.ensureMounted(nextIndex);
        }
        return;
      }

      // Resolve race condition during swipe:
      // If we've already reached nextIndex internally (e.g. via swipe),
      // skip the forced navigation from the prop update
      if (this.currentIndex === nextIndex) {
        this.ensureMounted(nextIndex);
        return;
      }

      // --- Forced navigation logic (e.g. button press) ---

      // The parent commanded this move: it needs no report back, reports
      // queued for moves it overrode are moot, and a live gesture no longer
      // owns the transition.
      this.reportedIndexQueue = [];
      this.pendingIndexChange = null;
      if (this.activePanGesture) {
        this.panGestureOverridden = true;
      }

      // [Important] Update ref (this.currentIndex) on external change
      this.currentIndex = nextIndex;

      this.startProgrammaticTransition(prevIndex, nextIndex);
    }
  }

  // --- 1. Mount Logic (Add Only) ---
  // This function only adds indices and never removes them.
  ensureMounted = (idx: number) => {
    this.setState((prevState) => {
      // During animation, preserve visit order by not re-inserting existing indices.
      if (prevState.mountedIndices.has(idx)) {
        return null; // No state change
      }
      // Add to the end so finite keepAlive eviction retains recent pages.
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

    this.setState((prevState) => {
      const newSet = new Set(prevState.mountedIndices);

      // Animation complete: move target to end of Set so finite keepAlive
      // eviction retains the most recently visited page.
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

      return { mountedIndices: new Set(toKeep) };
    });
  };

  commitProgrammaticTransition = (
    fromIndex: number,
    targetIndex: number,
    resetProgress: boolean
  ) => {
    if (resetProgress) {
      this.getProgress().setValue(fromIndex);
    }
    this.setState(
      (prevState) => {
        const mountedIndices = new Set(prevState.mountedIndices);
        mountedIndices.add(fromIndex);
        mountedIndices.add(targetIndex);

        return {
          activeIndex: fromIndex,
          mountedIndices,
          transitionTarget: targetIndex,
          swipingToIndex: null,
          departingIndex: fromIndex,
          isAnimating: true,
        };
      },
      () => {
        this.runAnimation(targetIndex, undefined, fromIndex);
      }
    );
  };

  selectRedirectSource = (
    progress: number,
    targetIndex: number,
    candidates: number[],
    fallbackIndex: number
  ): number => {
    const childCount = this.props.children.length;
    const validCandidates = Array.from(new Set(candidates)).filter(
      (index) => index >= 0 && index < childCount && index !== targetIndex
    );
    const bracketedCandidates = validCandidates.filter((index) => {
      const min = Math.min(index, targetIndex);
      const max = Math.max(index, targetIndex);
      return progress >= min && progress <= max;
    });

    if (bracketedCandidates.length > 0) {
      return bracketedCandidates.sort(
        (a, b) => Math.abs(progress - a) - Math.abs(progress - b)
      )[0]!;
    }

    return validCandidates.includes(fallbackIndex)
      ? fallbackIndex
      : (validCandidates[0] ?? this.state.activeIndex);
  };

  // Prepare the fixed-slot geometry before activating a native Screen. This is
  // important for react-native-screens: attaching the destination first and
  // correcting its position in a later commit can expose a stale screen for a
  // frame. The destination mount, participant activity states, and slot
  // positions are therefore committed together before the spring.
  startProgrammaticTransition = (fromIndex: number, targetIndex: number) => {
    if (this.props.animationType === 'none') {
      if (this.animationInstance) {
        this.animationInstance.stop();
        this.animationInstance = null;
      }
      this.ensureMounted(targetIndex);
      this.ensureMounted(fromIndex);
      this.getProgress().setValue(fromIndex);
      this.animateToIndex(targetIndex, true, fromIndex);
      return;
    }

    const interactionTarget = this.getInteractionTarget();
    if (this.state.isAnimating && interactionTarget !== null) {
      // Continue from the actual native-driver progress. The current value is
      // kept whenever it lies between one of the visible participants and the
      // new target, so 1 -> 0 interrupted at 0.5 continues as 0.5 -> 2.
      const candidates = [this.state.activeIndex, interactionTarget, fromIndex];
      if (this.animationInstance) {
        this.animationInstance.stop();
        this.animationInstance = null;
      }
      this.getProgress().stopAnimation((currentProgress) => {
        if (this.isUnmounted || this.currentIndex !== targetIndex) return;
        const sourceIndex = this.selectRedirectSource(
          currentProgress,
          targetIndex,
          candidates,
          fromIndex
        );
        this.commitProgrammaticTransition(sourceIndex, targetIndex, false);
      });
      return;
    }

    this.commitProgrammaticTransition(fromIndex, targetIndex, true);
  };

  reportIndexChange = (index: number) => {
    if (!this.props.onIndexChange) return;
    // Queued before the callback so a parent that re-renders synchronously
    // still sees the report as an expected echo.
    this.reportedIndexQueue.push(index);
    this.props.onIndexChange(index);
  };

  // Imperative moves retain their existing arrival-time reporting contract.
  flushIndexChange = () => {
    const index = this.pendingIndexChange;
    if (index === null) return;
    this.pendingIndexChange = null;
    this.reportIndexChange(index);
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
    if (departing !== targetIndex && this.state.departingIndex !== departing) {
      this.setState({ departingIndex: departing });
    }

    const anim = Animated.spring(this.getProgress(), {
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
        this.animationInstance = null;
        this.setState(
          {
            transitionTarget: null,
            swipingToIndex: null,
            departingIndex: null,
            activeIndex: targetIndex,
            isAnimating: false,
          },
          () => {
            this.pruneMountedIndices(targetIndex);
            this.flushIndexChange();
            this.props.onSwipeEnd?.(targetIndex);
          }
        );
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
          this.getProgress().setValue(targetIndex);
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
              this.flushIndexChange();
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
      const prevIndex = this.currentIndex;
      this.currentIndex = targetIndex;
      if (this.activePanGesture) {
        // An imperative move takes over a live gesture the same way an index
        // prop change does.
        this.panGestureOverridden = true;
      }

      if (animated) {
        this.startProgrammaticTransition(prevIndex, targetIndex);
      } else {
        this.ensureMounted(targetIndex);
        this.ensureMounted(prevIndex);
        this.animateToIndex(targetIndex, false, prevIndex);
      }
      this.pendingIndexChange = targetIndex;
    }
  };

  getInteractionTarget = (): number | null => {
    const { activeIndex, transitionTarget, swipingToIndex, departingIndex } =
      this.state;

    if (transitionTarget !== null && transitionTarget !== activeIndex) {
      return transitionTarget;
    }
    if (swipingToIndex !== null && swipingToIndex !== activeIndex) {
      return swipingToIndex;
    }
    if (departingIndex !== null && departingIndex !== activeIndex) {
      return departingIndex;
    }
    return null;
  };

  getItemPosition = (
    itemIndex: number
  ): number | Animated.AnimatedInterpolation<number> => {
    const { activeIndex } = this.state;
    const interactionTarget = this.getInteractionTarget();

    if (interactionTarget === null) {
      if (itemIndex === activeIndex) return 1;
      return itemIndex < activeIndex ? 0 : 2;
    }

    const direction = interactionTarget > activeIndex ? 1 : -1;
    const distance = interactionTarget - activeIndex;
    const normalizedProgress = Animated.divide(
      Animated.subtract(this.getProgress(), activeIndex),
      distance
    );

    if (itemIndex === activeIndex) {
      // The source moves from the viewport (1) to its parked side (0 or 2).
      return Animated.subtract(
        1,
        Animated.multiply(direction, normalizedProgress)
      );
    }
    if (itemIndex === interactionTarget) {
      // The destination starts at its parked side and moves into viewport 1.
      return Animated.add(
        1 + direction,
        Animated.multiply(-direction, normalizedProgress)
      );
    }

    // Non-participants remain detached at the source-relative parked side.
    return itemIndex < activeIndex ? 0 : 2;
  };

  getActivityState = (itemIndex: number): 0 | 1 | 2 => {
    const { activeIndex, isAnimating } = this.state;

    if (!isAnimating) {
      return itemIndex === activeIndex
        ? ActivityState.FULL_ACTIVE
        : ActivityState.INACTIVE;
    }

    const interactionTarget = this.getInteractionTarget();
    if (interactionTarget === null) {
      return itemIndex === activeIndex
        ? ActivityState.FULL_ACTIVE
        : ActivityState.INACTIVE;
    }

    const isMovingToAnotherPage = this.isMovingToAnotherPage();

    if (isMovingToAnotherPage) {
      if (itemIndex === interactionTarget) return ActivityState.FULL_ACTIVE;
      if (itemIndex === activeIndex) return ActivityState.PARTIAL_ACTIVE;
      return ActivityState.INACTIVE;
    }

    // An aborted gesture is returning to activeIndex: the current page is the
    // destination, while the preview page remains attached only until it parks.
    if (itemIndex === activeIndex) return ActivityState.FULL_ACTIVE;
    if (itemIndex === interactionTarget) return ActivityState.PARTIAL_ACTIVE;
    return ActivityState.INACTIVE;
  };

  isMovingToAnotherPage = (): boolean => {
    const { activeIndex, transitionTarget, swipingToIndex } = this.state;
    return (
      (transitionTarget !== null && transitionTarget !== activeIndex) ||
      (swipingToIndex !== null && swipingToIndex !== activeIndex)
    );
  };

  getLayoutOwnerIndex = (): number => {
    const { activeIndex, isAnimating } = this.state;
    const interactionTarget = this.getInteractionTarget();

    if (
      isAnimating &&
      interactionTarget !== null &&
      this.isMovingToAnotherPage()
    ) {
      return interactionTarget;
    }
    return activeIndex;
  };

  // --- Render Indices Calculation ---
  getRenderIndices = () => {
    const {
      mountedIndices,
      transitionTarget,
      swipingToIndex,
      departingIndex,
      activeIndex,
    } = this.state;
    const { children } = this.props;
    const childCount = children.length;

    // With unlimited keepAlive every native Screen wrapper stays mounted from
    // the first render. INACTIVE screens are still detached by
    // react-native-screens, but their parked slot is ready before reattachment.
    if (this.props.keepAlive === undefined) {
      return children.map((_, index) => index);
    }

    // 1. All currently mounted indices (added via ensureMounted)
    const combinedIndices = new Set(mountedIndices);

    // 2. [Required] Animation target
    if (transitionTarget !== null) combinedIndices.add(transitionTarget);
    // 3. [Required] Swipe preview target
    if (swipingToIndex !== null) combinedIndices.add(swipingToIndex);
    // 4. [Required] Aborted-swipe preview while it returns to its parked slot
    if (departingIndex !== null) combinedIndices.add(departingIndex);
    // 5. [Required] Currently active screen
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

    const { mountedIndices } = this.state;
    const containerSize = this.getCurrentContainerSize();
    const renderIndices = this.getRenderIndices();
    const layoutOwnerIndex = this.getLayoutOwnerIndex();

    const useNativeScreens = mode === 'native';
    const Container = useNativeScreens ? ScreenContainer : View;
    const containerProps = useNativeScreens ? { enabled: true } : {};

    // The pan handlers live on a plain RN View rather than on Container.
    // React Native only wires its JSResponderHandler into view groups that
    // implement ReactInterceptingViewGroup (ViewManager.java), and on Android
    // that handler is what makes a granted JS responder intercept touches so
    // that native descendants stop receiving them. ReactViewGroup implements
    // it; react-native-screens' ScreenContainer does not. With the handlers on
    // ScreenContainer, blockNativeResponder (on by default in PanResponder)
    // silently does nothing, so a scrollable inside a page can take the touch
    // away mid-swipe and the gesture dies as onPanResponderTerminate. Owning
    // the gesture from a View keeps that blocking intact while pages stay
    // wrapped in native screens.
    return (
      <View
        onLayout={this.handleLayout}
        style={[styles.container, style]}
        {...(this.props.swipeEnabled !== false
          ? this.panResponder.panHandlers
          : undefined)}
      >
        <Container {...containerProps} style={styles.container}>
          {renderIndices
            .filter((i) => children[i] != null)
            .map((i) => {
              const activityState = this.getActivityState(i);

              // Check if this child has never been mounted
              const isUnmounted =
                this.props.keepAlive !== undefined && !mountedIndices.has(i);
              // If swipeEnabled and never mounted, disable freeze to allow initial render
              const itemFreeze =
                this.props.swipeEnabled !== false && isUnmounted
                  ? false
                  : freeze;

              return (
                <PagerItem
                  key={i}
                  position={this.getItemPosition(i)}
                  isLayoutOwner={i === layoutOwnerIndex}
                  activityState={activityState}
                  containerSize={containerSize}
                  vertical={vertical}
                  animationType={animationType || 'slide'}
                  priority={activityState}
                  useNativeScreens={useNativeScreens}
                  freeze={itemFreeze}
                >
                  {children[i]!}
                </PagerItem>
              );
            })}
        </Container>
      </View>
    );
  }
}

export default FastPager;
