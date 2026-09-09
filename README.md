# react-native-fast-pager

High-performance swipe pager for React Native.

[한국어](docs/README.ko.md)

## Why?

### Rendering Optimization

`react-native-fast-pager` uses [react-native-screens](https://github.com/software-mansion/react-native-screens) and [react-freeze](https://github.com/software-mansion/react-freeze) internally to optimize rendering.

Each child page is assigned an `activityState`:

| Value | State | Description |
|---|---|---|
| `2` | `FULL_ACTIVE` | Currently focused page. Renders normally. |
| `1` | `PARTIAL_ACTIVE` | Page in transition (about to be focused or departing). Rendered but does not receive touch events. |
| `0` | `INACTIVE` | Inactive page. Detached from the native view hierarchy by `react-native-screens`, and frozen by `react-freeze` when `freeze` is on. |

This prevents unnecessary re-renders of off-screen children and reduces native view hierarchy overhead.

### Freezing Inactive Pages

`freeze` is **off by default**. Turn it on and an INACTIVE page is wrapped in [react-freeze](https://github.com/software-mansion/react-freeze), which hides its subtree behind Suspense so the page stops re-rendering while it is off screen.

Freezing rewrites the page's lifecycle. Going inactive destroys the page's layout effects and calls `componentWillUnmount` on its class components; coming back runs both again. Component state and passive effects (`useEffect`) survive. So mount is no longer a once-per-page event, and everything a page tears down on the way out has to be able to come back. `FlatList` is a class component, which means a frozen page runs that round trip on every visit.

Freezing only stops a page that already exists, so it never keeps one from mounting. A page rendered up front by `lazy={false}` renders once and is frozen from the next commit.

**The new architecture pays for this differently.** Hiding a subtree reaches the native views, and on the old architecture React sends one `UIManager.updateView` with `display: 'none'` to the view that is already mounted. Fabric's renderer is persistent and cannot mutate, so instead it clones the hidden host nodes with `display: none` (`cloneHiddenInstance`) and re-appends the parent's child set. Every freeze and unfreeze is therefore a shadow-tree commit and a mount transaction on the main queue, and under `renderMode="native"` those transactions already carry the pager's transition and the screens' attach/detach for the same commit.

**Switching very rapidly between heavy pages with `freeze` on has been reported to crash the app.** `react-native-screens` also keeps its own freeze behind an explicit `enableFreeze()` call, which stays off unless an app opts in.

Turn `freeze` on only when off-screen pages measurably cost you re-renders, and put rapid switching through QA on a real device on the architecture you ship.

### FlatList Integration

The `FastPager` component can be used as a FlatList item, making it easy to build tab-based UIs with sticky headers. See the [example](example/src/App.tsx).

## Installation

```sh
yarn add react-native-fast-pager react-native-screens react-freeze
```

or

```sh
npm install react-native-fast-pager react-native-screens react-freeze
```

> Native setup for `react-native-screens` is required. See the [react-native-screens installation guide](https://github.com/software-mansion/react-native-screens#installation).

## Usage

### Basic

```tsx
import { useState } from 'react';
import FastPager from 'react-native-fast-pager';

function App() {
  const [index, setIndex] = useState(0);

  return (
    <FastPager index={index} onIndexChange={setIndex}>
      <ScreenA />
      <ScreenB />
      <ScreenC />
    </FastPager>
  );
}
```

### Render Function

Pass children as functions to receive `activityState`, `priority`, and `diff`:

```tsx
<FastPager index={index} onIndexChange={setIndex}>
  {({ activityState, diff }) => <ScreenA activityState={activityState} />}
  {({ activityState, diff }) => <ScreenB activityState={activityState} />}
</FastPager>
```

### With FlatList

An example of building a sticky tab bar with FlatList:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, View } from 'react-native';
import FastPager from 'react-native-fast-pager';

const ITEMS = ['header', 'tab', 'pager'] as const;

function App() {
  const [tabIndex, setTabIndex] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const onProgressChange = useMemo(
    () =>
      Animated.event([{ nativeEvent: { progress } }], {
        useNativeDriver: true,
      }),
    [progress]
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof ITEMS)[number] }) => {
      switch (item) {
        case 'header':
          return <Header />;
        case 'tab':
          return <TabBar index={tabIndex} progress={progress} onPress={setTabIndex} />;
        case 'pager':
          return (
            <FastPager
              index={tabIndex}
              onIndexChange={setTabIndex}
              onProgressChange={onProgressChange}
            >
              <ScreenA />
              <ScreenB />
            </FastPager>
          );
      }
    },
    [tabIndex, progress, onProgressChange]
  );

  return (
    <FlatList
      data={ITEMS as unknown as (typeof ITEMS)[number][]}
      renderItem={renderItem}
      keyExtractor={(item) => item}
      stickyHeaderIndices={[1]}
    />
  );
}
```

`FastPager` reports progress through `onProgressChange`. It accepts a plain callback or an `Animated.event` mapping with either `useNativeDriver: true` or `useNativeDriver: false`.

With `useNativeDriver: true` and the standard `[{ nativeEvent: { progress } }]` mapping, the pager drives the mapped `Animated.Value` directly with its native-driver animations, so transition frames never cross the JS thread. Everything reading that value must stay native-driver compatible (transforms, opacity), and the value should not be animated from anywhere else. With `useNativeDriver: false` or a plain callback, updates are delivered from JavaScript on every frame.

## Gestures

The pager owns a swipe from the moment it reads a direction out of the touch, and it refuses to hand that touch back: `onPanResponderTerminationRequest` returns `false` and `onShouldBlockNativeResponder` returns `true`. On Android that is enough. The pan handlers sit on a plain `View`, and `ReactViewGroup` implements the intercepting behaviour React Native's `JSResponderHandler` needs, so native descendants stop receiving the touch.

On iOS `blockNativeResponder` is dropped. The legacy renderer takes the argument as `__unused` (`RCTUIManager.mm`), and on Fabric `RCTMountingManager` receives it but never forwards it past `setIsJSResponder:`. A native gesture recognizer, usually an enclosing or nested scroll view, can therefore take the touch away while the finger is still down. React Native reports that as `onPanResponderTerminate`.

A terminated gesture never picked a page, so the pager returns to the page it is on. It does not commit the swipe and does not call `onIndexChange`. Committing on the last known offset and velocity instead would turn the page before the user let go, because a velocity sampled mid-drag does not differ from a flick.

The library cannot prevent the handoff. When a specific scrollable competes with the pager on iOS, turn it off for the duration of the swipe:

```tsx
<FastPager
  onSwipeStart={() => setScrollEnabled(false)}
  onSwipeEnd={() => setScrollEnabled(true)}
>
```

`react-native-gesture-handler`'s `blocksExternalGesture` is the other lever when the competing gesture is itself a `GestureDetector`.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `PagerItemType[]` | *required* | Pages to transition between. ReactElement or render function. |
| `index` | `number` | `0` | Currently active page index. |
| `onIndexChange` | `(index: number) => void` | - | Called when a swipe picks a different page, on finger-up, before the settle animation runs. Not called for a snap-back, for a gesture the platform terminates (see [Gestures](#gestures)), or for `index` prop changes. `goTo` is reported once it lands. |
| `onProgressChange` | `(event: { nativeEvent: { progress: number } }) => void` | - | Called as animated progress changes. Compatible with `Animated.event([{ nativeEvent: { progress } }])`; with `useNativeDriver: true` the mapped value is driven natively. |
| `renderMode` | `'view' \| 'native'` | `'native'` | Set to `'native'` to use the native `ScreenContainer` implementation. |
| `animationType` | `'slide' \| 'fade' \| 'fade-slide' \| 'none'` | `'slide'` | Transition animation type. |
| `swipeEnabled` | `boolean` | `true` | Whether swipe gestures are enabled. |
| `vertical` | `boolean` | `false` | Set to `true` to transition vertically. |
| `keepAlive` | `number` | `undefined` (unlimited) | Maximum number of pages to keep mounted. Used for memory optimization. |
| `lazy` | `boolean` | `true` | Mount a page when it is first visited instead of on the first render. Set to `false` to mount every page up front (ignored when `keepAlive` is set); pages parked off screen mount once the container has been measured. Mounted pages stay mounted unless `keepAlive` limits them. |
| `freeze` | `boolean` | `false` | Whether to apply `react-freeze` to inactive pages. Read [Freezing Inactive Pages](#freezing-inactive-pages) before turning this on: it changes a page's lifecycle, costs more on the new architecture, and has been reported to crash under very rapid switching between heavy pages. |
| `layout` | `{ width?: number; height?: number }` | - | Manually specify container size. Auto-measured via `onLayout` if not provided. |
| `style` | `StyleProp<ViewStyle>` | - | Container style. |
| `onSwipeStart` | `() => void` | - | Called when a swipe gesture starts. |
| `onSwipeEnd` | `(index: number) => void` | - | Called after the swipe animation completes. |
| `onLayout` | `(event: LayoutChangeEvent) => void` | - | Container layout event. |

## Ref Methods

Access imperative methods via `ref`:

| Method | Type | Description |
|---|---|---|
| `goTo` | `(index: number, animated?: boolean) => void` | Navigate to the given index. |
| `progress` | `Animated.Value` | Current animated progress value. |

## Exports

```ts
import FastPager, {
  ActivityState,
  type RenderMode,
  type AnimationType,
  type FastPagerProgressChangeEvent,
  type FastPagerInstance,
  type FastPagerProps,
} from 'react-native-fast-pager';
```

## License

MIT
