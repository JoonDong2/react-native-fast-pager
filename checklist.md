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
