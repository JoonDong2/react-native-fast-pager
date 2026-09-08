# 컨텍스트 노트 — 제스처 커밋 시점 정리 (2026-08-09)

작업 중 내린 결정과 근거. 다음 세션이 재추론 없이 이어갈 수 있도록 기록한다.

## 왜 `onIndexChange`가 사라졌나 (이슈 2)
- 기존: `settlePan`이 `pendingIndexChange`에 담아두고 settle 스프링이 `finished: true`로 끝날 때만 발화.
- 스프링이 `tension: 100, friction: 12` (ω₀=10, ζ=0.6)라 감쇠 포락선이 `e^(-6t)`. RN의 rest 임계값(변위/속도 0.001)까지 **약 1.1초**가 걸린다.
- 그 사이 새 제스처가 들어오면 `onMoveShouldSetPanResponderCapture`가 애니메이션을 `stop()` → `finished: false` → 보고가 통째로 유실. 즉 "빠르게 스와이프하면 칩이 안 바뀐다".
- 결론: 사용자가 손을 뗀 순간 목적지는 이미 확정되므로, 그 시점에 보고한다. 애니메이션 완료에 의존하지 않으니 중단돼도 유실되지 않는다.
- `goTo`/`index` prop 이동은 기존 계약(도착 후 보고, `pendingIndexChange` → `flushIndexChange`)을 유지한다. 명령한 쪽은 목적지를 이미 알고 있어서 조기 보고의 이득이 없다.

## terminate를 release와 분리 (이슈 1)
- iOS Fabric은 `setJSResponder`를 구현하지 않는다(`RCTSurfaceTouchHandler`에 없음, 레거시 `RCTUIManager.mm`에만 존재). 그래서 `blockNativeResponder`가 무력하고, 바깥 제스처 인식기가 터치를 가져가면 손가락이 화면에 있는 채로 `onPanResponderTerminate`가 온다.
- 기존 코드는 terminate를 release와 동일하게 취급해 거리/속도로 커밋 → 손을 떼지 않았는데 페이지가 넘어감.
- 정책: 제스처 중 터치는 누구도 가져갈 수 없다는 전제. 그럼에도 강제 종료되면 목적지를 고른 적이 없는 제스처이므로 **현재 페이지로 복귀**한다. `onShouldBlockNativeResponder: () => true`를 명시해 responder 차단을 문서화한다(RN 0.81/0.85 기본값과 동일하지만 구버전 RN은 Android 전용이었다).
- 남은 한계: iOS Fabric에서는 라이브러리 쪽에서 강탈 자체를 막을 수단이 없다. 앱 쪽 레버(`onSwipeStart`에서 바깥 리스트 `scrollEnabled=false`, RNGH `blocksExternalGesture`)가 필요하면 사용처에서 건다.

## 드래그 기준점 (`gestureAnchor`)
- 기존 `onPanResponderMove`는 `currentIndex + offset`으로 progress를 계산했다. `settlePan`이 release 즉시 `currentIndex`를 목적지로 올려두기 때문에, 전환이 끝나기 전에 다시 잡으면 화면은 1.5인데 값이 2.06으로 튄다 → 손가락 아래에서 페이지가 즉시 넘어가 보인다.
- 그래서 grant 시점에 실제 progress를 읽어 기준점으로 삼는다. native driver 값은 JS 쪽 `__getValue()`가 낡아 있으므로 `stopAnimation(cb)`(내부적으로 `NativeAnimatedAPI.getValue`)로 비동기 조회한다. 이미 `startProgrammaticTransition`이 쓰던 방식이다.
- 값이 도착하기 전의 move는 **건너뛴다**. 잘못된 기준으로 한 프레임 그리는 것보다 한 프레임 멈춰 있는 편이 낫다. 애니메이션이 없던 평상시 제스처는 동기적으로 `currentIndex`를 쓰므로 이 지연이 없다.
- `gestureSequence`로 제스처가 끝난 뒤 도착한 읽기를 폐기한다.

## 드래그 중 참여 페이지 동기화 (`syncDragParticipants`)
- `getItemPosition`은 `activeIndex`와 `interactionTarget` 두 페이지만 progress에 물린다. 나머지는 0/2에 주차된다.
- 인계 드래그나 페이지 경계를 넘는 드래그에서는 progress가 그 쌍 밖으로 나가므로 화면에 빈 공간이 생긴다(기존에도 있던 결함).
- 그래서 매 move마다 쌍을 `{floor(progress), ceil(progress)}`로 맞춘다. 정수 지점에서 두 모델의 위치 계산이 정확히 일치하므로(둘 다 `1 + i - p`) 쌍을 교체해도 튀지 않는다.
- `activeIndex`가 드래그 중에 바뀌는 건 기존과 달라진 점이다. 다만 바뀌는 시점은 실제로 페이지 경계를 넘을 때뿐이고, 그 전까지는 렌더가 틀려 있던 구간이다.
- settle 대상은 `clamp(target, floor(p), ceil(p))`로 화면에 보이는 두 페이지로 제한한다. 그러지 않으면 1.75에서 3으로 튀며 중간 페이지가 사라진다.
- 임계값 판정 기준 페이지는 `Math.round(anchor)` (제스처를 시작한 페이지). 평상시 제스처에서는 `currentIndex`와 같아 기존 감각이 그대로 유지된다.

## 숨겨진 서브트리에서 살아 돌아오기 (2026-08-09 추가)
- 증상: 바텀탭(FastPager)에서 탭을 몇 번 오간 뒤 Archive 탭에 들어가면 스와이프가 엉뚱한 위치에 멈추고 칩을 눌러도 반응이 없다. 앱 시작 직후 바로 들어가면 정상.
- 원인: `freeze`가 비활성 페이지를 `<Freeze>`(Suspense)로 숨기는데, React는 숨겨지는 트리의 **클래스 컴포넌트에 `componentWillUnmount`를 호출**한다(React 19 `disappearLayoutEffects`, `ReactFabric-dev.js:11765` case 1). 인스턴스와 state는 유지되고 다시 보일 때 `componentDidMount`가 재호출된다.
- `isUnmounted = true`를 되돌리는 곳이 없어서, 탭을 한 번이라도 떠나면 `runAnimation` 완료 콜백 / `startProgrammaticTransition`의 `stopAnimation` 콜백(= 칩 누름) / 제스처 anchor 읽기가 전부 조기 return 됐다. 즉 pager가 자기 애니메이션 콜백을 영구히 무시한다.
- 수정: `componentDidMount`에서 `isUnmounted`를 되돌리고, 숨겨질 때 끊긴 전환을 현재 인덱스에 정착시킨다(`resumeAfterMount`). `componentWillUnmount`가 애니메이션을 멈춰버려 아무도 완료를 보고하지 않으므로, 상태를 직접 정리하지 않으면 이후 모든 제스처가 끝나지 않는 전환 위에서 계산된다.
- 제스처 상태와 `reportedIndexQueue`도 함께 비운다. 숨겨지기 전에 보고한 인덱스는 이미 의미가 없고, 남아 있으면 이후 진짜 index 변경이 에코로 오인돼 삼켜진다(칩 무반응의 두 번째 경로).
- 교훈: 이 컴포넌트에서 mount는 최초 1회가 아니다. `componentWillUnmount`에서 정리하는 것은 전부 `componentDidMount`에서 복구돼야 한다.

## 여러 페이지를 건너뛰는 전환의 인계 (2026-09-08 추가)
- 위 "드래그 중 참여 페이지 동기화" 항목의 전제("정수 지점에서 두 모델이 일치하므로 쌍을 교체해도 튀지 않는다")는 **이웃한 두 페이지 사이의 전환에만** 성립한다.
- `goTo(2)`처럼 거리 2 이상인 전환은 `getItemPosition`이 progress를 `distance`로 나눠 쓴다. progress 1.0은 "페이지 1에 도착"이 아니라 "0→2 여정의 절반"이고, 화면에는 페이지 0이 0.5, 페이지 2가 1.5에 있다. 이 배치는 어떤 이웃 쌍으로도 표현할 수 없다.
- 그래서 인계 첫 move에서 쌍을 `{floor, ceil}`로 다시 잡으면 목적지 페이지 2가 참여자에서 빠져 2로 튀고, 화면에 없던 페이지 1이 0.95로 밀려 들어온다. 손가락 아래에서 페이지가 통째로 바뀌어 보인다.
- 수정: `heldTransitionPair`. progress가 인계한 전환의 두 끝 **사이에 있는 동안** 그 쌍을 그대로 유지하고, 끝(정수 지점)에 닿으면 그때 이웃 모델로 넘긴다. 끝에서는 두 모델의 위치 계산이 일치하므로 인계가 매끄럽다.
- 거리 1인 전환은 재계산이 어차피 항등이라 기존 경로를 그대로 둔다(`< 2`에서 조기 반환). 통과 중인 테스트의 감각을 바꾸지 않기 위한 의도적 제한이다.
- 트레이드오프: 쌍이 유지되는 동안 progress 1단위가 화면 1/distance만큼만 움직이므로 페이지가 손가락보다 느리게 따라온다. offset에 distance를 곱해 1:1로 맞추려면 구간을 벗어날 때 anchor를 다시 잡아야 하고(누적 offset이라 불연속이 생긴다) 상태가 늘어난다. 튀는 것보다 느린 편이 낫다고 보고 배율은 넣지 않았다.
- settle도 같은 제약을 받는다. 유지된 쌍의 두 끝만 배치돼 있으므로 그 사이 페이지로는 정착할 수 없다. 플릭 방향이 있으면 그쪽 끝, 아무것도 결정하지 않았으면 원래 향하던 목적지로 간다.

## anchor를 못 읽은 채 끝난 제스처 (2026-09-08 추가)
- `onPanResponderMove`는 anchor가 없으면 프레임을 건너뛰는데(위 참조), `settlePan`만 `anchor ?? this.currentIndex`로 대체하고 있었다.
- `currentIndex`는 인계당한 전환의 **목적지**로 이미 올라가 있다. 빠른 플릭으로 anchor 읽기보다 손이 먼저 떨어지면, 페이지는 한 번도 움직이지 않았는데 목적지 기준으로 임계값을 재서 그 너머 페이지를 커밋하고 `onIndexChange`까지 보고했다.
- 수정: anchor가 없으면 `cancelPan`에 위임한다. 화면을 건드리지 않은 제스처는 목적지를 고른 적이 없으므로, terminate와 같은 취급을 받아 인계당한 전환이 그대로 이어진다.
- 이 결함은 base 브랜치부터 있던 것이고, `?? currentIdx` 대체를 지우면서 `settlePan`의 추측 경로가 완전히 사라졌다.

## 스프링 파라미터는 건드리지 않음
- ζ=0.6, ω₀=10이면 첫 오버슈트가 0.39초에 9.5%, 시각적 정착까지 0.6~0.8초다. 느리고 탄력 있는 편이지만 이번 요청 범위 밖이라 유지했다. 보고 시점을 release로 옮겨 체감 지연은 사라진다.

## `lazy={false}`가 무효였던 이유 (2026-09-09 추가)
- 실측(자식 3개, 마운트되는 페이지). 0.1.18 기본값 `[a, b, c]`, 1.0.6 기본값 `[a]`, 1.0.6 `lazy={false}` `[a]`, 1.0.6 `lazy={false} freeze={false}` `[a, b, c]`. `renderMode="view"`도 동일.
- 원인은 react-freeze 1.0.4의 `Suspender`다. `freeze`가 true면 children을 렌더하기 **전에** thenable을 던진다. 그래서 `<Freeze freeze>`로 태어난 서브트리는 "동결"이 아니라 "존재하지 않음"이다.
- `lazy={false}`는 `mountedIndices`를 전체로 채우고 `getRenderIndices`도 전체를 반환하지만, 활성 페이지를 뺀 나머지는 INACTIVE라 `shouldFreeze`가 true가 되고 결국 한 번도 마운트되지 않았다.
- 0.1.18에서 같은 조합이 문제가 아니었던 건 동결이 **실제로 일어나지 않았기 때문**이다. 네이티브 모드는 `<AnimatedScreen shouldFreeze={...}>`만 넘겼고, RNS는 `freezeOnBlur = freezeEnabled()`를 하드 AND 게이트로 쓴다(`core.ts`의 `ENABLE_FREEZE = false`). `enableFreeze()`를 부르지 않으면 그 값은 무시된다. 0.1.18의 eager는 동결이 무효인 위에 서 있던 동작이다.
- 수정 원칙: **동결은 존재하는 페이지를 멈추는 수단이지, 페이지가 생기는 것을 막는 수단이 아니다.** 그래서 `PagerItem`이 한 번도 렌더된 적 없는 콘텐츠는 동결하지 않는다(`hasRenderedContent`).
- `a568de7`("측정 전 레이아웃 금지")과 충돌하지 않도록 `containerSize === 0`인 동안은 동결을 유지한다. 측정이 끝나면 한 번 렌더하고, 그 커밋의 effect에서 `hasRenderedContent`를 올려 다음 커밋부터 동결한다. lazy 경로는 애초에 마운트돼야 할 때만 렌더되고 그 시점의 activityState가 INACTIVE가 아니라서 이 우회로를 타지 않는다.
- 비용: `lazy={false}` 페이지는 마운트 직후 곧바로 동결되므로 layout effect와 클래스 `componentWillUnmount`를 한 번 왕복한다. `useEffect`와 state는 살아남는다(React 19.1 실측: 동결 시 `layout-cleanup` + `class-willUnmount`만, 해제 시 `layout-effect` + `class-didMount`만). 데이터 페칭을 미리 띄우려는 `lazy={false}`의 본래 목적은 그대로 달성된다.
- `FastPager`의 `itemFreeze`는 같은 의도를 `swipeEnabled !== false && mountsLazily && !mountedIndices.has(i)`라는 조건으로 부분적으로만 표현하고 있었다. lazy 경로에서 `renderIndices`에는 있는데 `mountedIndices`에는 없는 페이지는 항상 참여자(FULL/PARTIAL_ACTIVE)라 조건이 성립할 일이 없어 사실상 죽은 코드였다. 규칙이 두 군데로 갈라지는 걸 피하려고 지웠다.
