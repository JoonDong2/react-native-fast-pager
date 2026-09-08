# 체크리스트 — 제스처 커밋 시점 정리 (2026-08-09)

## 배경
- 이슈 1: 빠른 플릭 한 번에 손을 떼기 전에 페이지가 넘어감.
- 이슈 2: mohe_app Archive 탭에서 스와이프해도 상단 칩이 안 바뀜.
- 요청: `onIndexChange`를 "이동 완료 후"가 아니라 "제스처가 해제됐을 때" 발화.

## 작업
- [x] `onPanResponderTerminate`를 release와 분리 — 강제 종료는 페이지를 커밋하지 않고 현재 페이지로 복귀
- [x] `onShouldBlockNativeResponder`를 명시적으로 true (제스처 중 네이티브 responder 차단)
- [x] `onIndexChange`를 release 시점에 발화 (`settlePan`에서 즉시 보고)
- [x] `onMoveShouldSetPanResponderCapture` — 경계 검사를 애니메이션 정지보다 먼저 (경계에서 전환이 중간에 멈추는 문제)
- [x] 드래그 기준점을 화면상 progress로 고정 (`gestureAnchor`) — 전환 중 재스와이프 시 progress 점프 제거
- [x] 드래그 중 참여 페이지 쌍을 progress에 맞춰 동기화 (`syncDragParticipants`) — activeIndex 고착/페이지 사이 빈 공간 제거
- [x] settle 대상은 화면에 보이는 두 페이지로 제한
- [x] 테스트 추가 (release 보고, terminate 취소, 전환 중 인계, 경계)
- [x] README.md / docs/README.ko.md 의 `onIndexChange` 설명 갱신

## 검증
- [x] `yarn test`
- [x] `yarn typecheck`
- [x] `yarn lint`

---

# 체크리스트 — 인계 드래그 잔여 결함 (2026-09-08)

## 배경
- ultrareview가 `FastPager`의 전환 인계 경로에서 확정 결함 2건을 보고.
- 결함 1(신규): 여러 페이지를 건너뛰는 전환을 드래그가 인계하면 첫 move에서 쌍이 재계산돼 목적지 페이지가 사라지고 중간 페이지가 튀어 들어옴.
- 결함 2(기존): anchor 비동기 읽기가 도착하기 전에 손을 떼면 `settlePan`이 `currentIndex`로 대체해 화면과 무관한 페이지를 커밋.

## 작업
- [x] `heldTransitionPair` — 인계한 전환의 두 끝 사이에 progress가 있는 동안 쌍을 유지
- [x] `syncDragParticipants` — 쌍이 유지되는 구간에서는 상태를 건드리지 않음
- [x] `settlePan` — 유지된 쌍에서는 두 끝 중 하나로만 커밋 (플릭 방향, 없으면 원래 목적지)
- [x] `settlePan` — anchor 미도착 시 `cancelPan`에 위임 (추측 대체 제거)
- [x] 테스트 3개 추가 (인계 직후 위치 유지, 무결정 release, anchor 미도착 release)

## 검증
- [x] `yarn test` (35 passed)
- [x] `yarn typecheck`
- [x] `yarn lint`
- [x] 수정 전 소스에서 새 테스트 3개가 모두 실패하는지 확인
