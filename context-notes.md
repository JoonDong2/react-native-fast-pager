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

## 스프링 파라미터는 건드리지 않음
- ζ=0.6, ω₀=10이면 첫 오버슈트가 0.39초에 9.5%, 시각적 정착까지 0.6~0.8초다. 느리고 탄력 있는 편이지만 이번 요청 범위 밖이라 유지했다. 보고 시점을 release로 옮겨 체감 지연은 사라진다.
