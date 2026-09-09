# react-native-fast-pager

React Native을 위한 스와이프 가능한 화면 전환 컴포넌트입니다.

[English](../README.md)

## Why?

### 렌더링 최적화

`react-native-fast-pager`는 내부적으로 [react-native-screens](https://github.com/software-mansion/react-native-screens)와 [react-freeze](https://github.com/software-mansion/react-freeze)를 사용하여 렌더링을 최적화합니다.

각 자식 화면에는 `activityState`가 부여됩니다:

| 값 | 상태 | 설명 |
|---|---|---|
| `2` | `FULL_ACTIVE` | 현재 포커스된 화면. 정상적으로 렌더링됩니다. |
| `1` | `PARTIAL_ACTIVE` | 전환 중인 화면(포커스 예정 또는 떠나는 중). 렌더링은 되지만 터치 이벤트를 받지 않습니다. |
| `0` | `INACTIVE` | 비활성 화면. `react-native-screens`에 의해 네이티브 뷰 계층에서 분리되고, `freeze`가 켜져 있으면 `react-freeze`에 의해 렌더링이 동결됩니다. |

이 방식으로 현재 보이지 않는 화면의 불필요한 리렌더링을 방지하고, 네이티브 뷰 계층의 부하를 줄입니다.

### 비활성 페이지 동결

`freeze`는 **기본값이 꺼짐**입니다. 켜면 INACTIVE 페이지가 [react-freeze](https://github.com/software-mansion/react-freeze)로 감싸이고, 서브트리가 Suspense 뒤에 숨겨져 화면 밖에 있는 동안 리렌더링을 멈춥니다.

동결은 페이지의 라이프사이클을 바꿉니다. 비활성으로 바뀔 때 layout effect가 정리되고 클래스 컴포넌트의 `componentWillUnmount`가 호출되며, 다시 보일 때 둘 다 재실행됩니다. 컴포넌트 state와 `useEffect`는 유지됩니다. 즉 마운트는 더 이상 페이지당 한 번이 아니고, 페이지가 떠날 때 정리하는 것은 전부 되돌아올 수 있어야 합니다. `FlatList`가 클래스 컴포넌트이므로 동결된 페이지는 방문할 때마다 이 왕복을 겪습니다.

동결은 이미 존재하는 페이지를 멈추는 것이라 마운트 자체를 막지는 않습니다. `lazy={false}`로 미리 렌더되는 페이지는 한 번 렌더된 뒤 다음 커밋부터 동결됩니다.

**New Architecture는 이 비용을 다르게 치릅니다.** 서브트리를 숨기는 일은 네이티브 뷰까지 내려갑니다. 구 아키텍처에서는 이미 마운트된 뷰에 `UIManager.updateView`로 `display: 'none'`을 한 번 보내는 것으로 끝납니다. Fabric의 렌더러는 persistent라 뷰를 변형할 수 없어서, 숨길 호스트 노드를 `display: none`으로 복제하고(`cloneHiddenInstance`) 부모의 자식 집합을 다시 만듭니다. 그래서 동결과 해제가 매번 shadow tree 커밋과 메인 큐 마운트 트랜잭션이 되고, `renderMode="native"`에서는 그 트랜잭션이 이미 pager의 전환과 screens의 attach/detach를 함께 나르고 있습니다.

**무거운 페이지를 매우 빠르게 전환하면서 `freeze`를 켜둔 상태에서 크래시가 보고된 적이 있습니다.** `react-native-screens`도 자체 동결을 `enableFreeze()` 호출 뒤에 두고, 앱이 직접 켜지 않는 한 꺼둡니다.

화면 밖 페이지의 리렌더링 비용이 실제로 측정될 때만 `freeze`를 켜고, 배포하는 아키텍처의 실기기에서 빠른 전환을 QA에 포함하세요.

### FlatList 연동

`FastPager` 컴포넌트는 FlatList의 아이템으로 사용할 수 있어, stickyHeader와 함께 탭 기반 UI를 쉽게 구현할 수 있습니다. [example](../example/src/App.tsx)을 참고하세요.

## 설치

```sh
yarn add react-native-fast-pager react-native-screens react-freeze
```

또는

```sh
npm install react-native-fast-pager react-native-screens react-freeze
```

> `react-native-screens`의 네이티브 설정이 필요합니다. [react-native-screens 설치 가이드](https://github.com/software-mansion/react-native-screens#installation)를 참고하세요.

## 사용법

### 기본

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

자식을 함수로 전달하면 `activityState`, `priority`, `diff` 값을 받을 수 있습니다:

```tsx
<FastPager index={index} onIndexChange={setIndex}>
  {({ activityState, diff }) => <ScreenA activityState={activityState} />}
  {({ activityState, diff }) => <ScreenB activityState={activityState} />}
</FastPager>
```

### FlatList 연동

FlatList와 함께 사용하여 sticky 탭 바를 구현하는 예시입니다:

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

`FastPager`는 `onProgressChange`로 진행 값을 전달합니다. 일반 콜백뿐 아니라 `useNativeDriver: true`/`false` 어느 쪽의 `Animated.event` 매핑도 전달할 수 있습니다.

`useNativeDriver: true`에 표준 `[{ nativeEvent: { progress } }]` 매핑을 사용하면 pager가 매핑된 `Animated.Value`를 native driver 애니메이션으로 직접 구동하므로, 전환 프레임이 JS 스레드를 거치지 않습니다. 이 값을 읽는 곳은 native driver 호환(transform, opacity)이어야 하고, 다른 곳에서 이 값을 애니메이션하면 안 됩니다. `useNativeDriver: false` 또는 일반 콜백은 매 프레임 JavaScript에서 값을 전달합니다.

## 제스처

pager는 터치에서 방향을 읽어낸 순간부터 스와이프를 소유하고, 그 터치를 돌려주지 않습니다. `onPanResponderTerminationRequest`가 `false`를, `onShouldBlockNativeResponder`가 `true`를 반환합니다. 안드로이드에서는 이것으로 충분합니다. 팬 핸들러가 plain `View` 위에 있고, `ReactViewGroup`이 React Native의 `JSResponderHandler`가 요구하는 인터셉트 동작을 구현하므로 네이티브 자손이 터치를 더 받지 않습니다.

iOS에서는 `blockNativeResponder`가 버려집니다. 레거시 렌더러는 이 인자를 `__unused`로 받고(`RCTUIManager.mm`), Fabric의 `RCTMountingManager`는 인자로 받기는 하지만 `setIsJSResponder:` 너머로 전달하지 않습니다. 그래서 바깥이나 안쪽의 스크롤 뷰 같은 네이티브 제스처 인식기가 손가락이 화면에 있는 상태에서 터치를 가져갈 수 있습니다. React Native는 이를 `onPanResponderTerminate`로 알립니다.

강제 종료된 제스처는 페이지를 고른 적이 없으므로 pager는 원래 페이지로 돌아갑니다. 스와이프를 커밋하지 않고 `onIndexChange`도 호출하지 않습니다. 마지막으로 알려진 거리와 속도로 커밋하면 사용자가 손을 떼기 전에 페이지가 넘어갑니다. 드래그 도중에 샘플링된 속도는 플릭과 구분되지 않기 때문입니다.

강탈 자체는 라이브러리에서 막을 수 없습니다. iOS에서 특정 스크롤 뷰가 pager와 경쟁한다면 스와이프가 진행되는 동안 그 뷰를 꺼두세요.

```tsx
<FastPager
  onSwipeStart={() => setScrollEnabled(false)}
  onSwipeEnd={() => setScrollEnabled(true)}
>
```

경쟁하는 제스처가 `GestureDetector`라면 `react-native-gesture-handler`의 `blocksExternalGesture`가 다른 레버입니다.

## Props

| Prop | Type | Default | 설명 |
|---|---|---|---|
| `children` | `PagerItemType[]` | *필수* | 전환할 페이지 목록. ReactElement 또는 render function. |
| `index` | `number` | `0` | 현재 활성 페이지의 인덱스. |
| `onIndexChange` | `(index: number) => void` | - | 스와이프가 다른 페이지를 선택하면 손을 뗀 시점에, settle 애니메이션 전에 호출됩니다. 원래 페이지로 돌아가거나, 제스처가 강제 종료되거나([제스처](#제스처) 참고), `index` prop으로 이동한 경우에는 호출되지 않습니다. `goTo`는 이동이 끝난 뒤에 보고합니다. |
| `onProgressChange` | `(event: { nativeEvent: { progress: number } }) => void` | - | animated progress가 변경될 때 호출됩니다. `Animated.event([{ nativeEvent: { progress } }])`와 함께 사용할 수 있으며, `useNativeDriver: true`면 매핑된 값을 네이티브에서 직접 구동합니다. |
| `renderMode` | `'view' \| 'native'` | `'native'` | `'native'`로 설정하면 네이티브 `ScreenContainer` 구현을 사용합니다. |
| `animationType` | `'slide' \| 'fade' \| 'fade-slide' \| 'none'` | `'slide'` | 전환 애니메이션 종류. |
| `swipeEnabled` | `boolean` | `true` | 스와이프 제스처 활성화 여부. |
| `vertical` | `boolean` | `false` | `true`로 설정하면 세로 방향으로 전환합니다. |
| `keepAlive` | `number` | `undefined` (무제한) | 마운트 상태를 유지할 최대 페이지 수. 메모리 최적화에 사용합니다. |
| `lazy` | `boolean` | `true` | 페이지를 처음 방문할 때(스와이프로 향하거나 `index`/`goTo`로 지정될 때) 마운트합니다. `false`면 모든 페이지를 처음부터 마운트합니다(`keepAlive` 지정 시에는 무시). 화면 밖에 주차된 페이지는 컨테이너가 측정된 뒤에 마운트됩니다. 마운트된 페이지는 `keepAlive`로 제한하지 않는 한 유지됩니다. |
| `freeze` | `boolean` | `false` | 비활성 페이지에 `react-freeze`를 적용할지 여부. 켜기 전에 [비활성 페이지 동결](#비활성-페이지-동결)을 읽어보세요. 페이지 라이프사이클이 바뀌고, New Architecture에서 비용이 더 크며, 무거운 페이지를 매우 빠르게 전환할 때 크래시가 보고된 적이 있습니다. |
| `layout` | `{ width?: number; height?: number }` | - | 컨테이너 크기를 직접 지정합니다. 미지정 시 `onLayout`으로 자동 측정됩니다. |
| `style` | `StyleProp<ViewStyle>` | - | 컨테이너 스타일. |
| `onSwipeStart` | `() => void` | - | 스와이프 제스처가 시작될 때 호출됩니다. |
| `onSwipeEnd` | `(index: number) => void` | - | 스와이프 애니메이션이 완료된 후 호출됩니다. |
| `onLayout` | `(event: LayoutChangeEvent) => void` | - | 컨테이너 레이아웃 이벤트. |

## Ref 메서드

`ref`를 통해 명령형 메서드에 접근할 수 있습니다:

| 메서드 | Type | 설명 |
|---|---|---|
| `goTo` | `(index: number, animated?: boolean) => void` | 지정한 인덱스로 이동합니다. |
| `progress` | `Animated.Value` | 현재 animated progress 값. |

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
