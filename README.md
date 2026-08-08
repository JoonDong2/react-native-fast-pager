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
| `0` | `INACTIVE` | Inactive page. Rendering is frozen by `react-freeze` and detached from the native view hierarchy by `react-native-screens`. |

This prevents unnecessary re-renders of off-screen children and reduces native view hierarchy overhead.

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

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `PagerItemType[]` | *required* | Pages to transition between. ReactElement or render function. |
| `index` | `number` | `0` | Currently active page index. |
| `onIndexChange` | `(index: number) => void` | - | Called after a swipe settles on a different page. |
| `onProgressChange` | `(event: { nativeEvent: { progress: number } }) => void` | - | Called as animated progress changes. Compatible with `Animated.event([{ nativeEvent: { progress } }])`; with `useNativeDriver: true` the mapped value is driven natively. |
| `renderMode` | `'view' \| 'native'` | `'native'` | Set to `'native'` to use the native `ScreenContainer` implementation. |
| `animationType` | `'slide' \| 'fade' \| 'fade-slide' \| 'none'` | `'slide'` | Transition animation type. |
| `swipeEnabled` | `boolean` | `true` | Whether swipe gestures are enabled. |
| `vertical` | `boolean` | `false` | Set to `true` to transition vertically. |
| `keepAlive` | `number` | `undefined` (unlimited) | Maximum number of pages to keep mounted. Used for memory optimization. |
| `freeze` | `boolean` | `true` | Whether to apply `react-freeze` to inactive pages. |
| `layout` | `{ width?: number; height?: number }` | - | Manually specify container size. Auto-measured via `onLayout` if not provided. |
| `style` | `StyleProp<ViewStyle>` | - | Container style. |
| `onSwipeStart` | `() => void` | - | Called when a swipe gesture starts. |
| `onSwipeRelease` | `(index: number) => void` | - | Called when finger-up commits a different page, before the settle animation. Not called for snap-back, responder termination, or programmatic moves. |
| `onSwipeEnd` | `(index: number) => void` | - | Called after the swipe animation completes. |
| `onLayout` | `(event: LayoutChangeEvent) => void` | - | Container layout event. |

Use `onSwipeRelease` for early gesture intent only. Keep layout, scrolling, and active-page side effects on `onIndexChange` or `onSwipeEnd`, after the pager has settled.

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
