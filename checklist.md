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

---

# 체크리스트 — `lazy={false}`가 실제로 마운트하도록 (2026-09-09)

## 배경
- 앱에서 0.1.18 → 1.0.6으로 올린 뒤 받은 리뷰. 기본값이 eager → lazy로 바뀌어 탭 첫 진입에 로딩 중 오상태가 노출된다는 지적.
- 리뷰가 제시한 해법 `lazy={false}`를 실제로 걸어보니 무효였다. `README.md:146`의 "mount every page up front"가 거짓인 상태.
- 원인: `freeze`가 첫 렌더부터 켜지면 react-freeze가 children을 렌더하기 전에 suspend하므로 서브트리가 아예 마운트되지 않는다.

## 작업
- [x] `PagerItem` — 한 번도 렌더된 적 없는 콘텐츠는 동결하지 않음. 컨테이너 측정 후 한 번 렌더하고 다음 커밋부터 동결
- [x] `FastPager` — 같은 의도를 부분적으로만 표현하던 `itemFreeze` 제거 (`PagerItem` 쪽 규칙이 대체)
- [x] 테스트 `FastPager.mount.native.test.tsx` 추가 (기본 lazy, `lazy={false}`, 측정 전 보류, `keepAlive` 우선, index 이동)
- [x] 테스트 `PagerItem.native.test.tsx` 갱신 (비활성 페이지가 한 번 마운트된 뒤 동결 / 측정 전에는 미렌더)
- [x] README.md, docs/README.ko.md — 동결의 라이프사이클 계약과 `lazy`의 측정 대기 명시
- [x] 리뷰 2번(terminate 시 스냅백) — 현행 동작 유지로 결정. README 양쪽에 iOS 강탈 한계와 앱 쪽 레버를 문서화

## 검증
- [x] `yarn test` (41 passed)
- [x] `yarn typecheck`
- [x] `yarn lint`
- [x] 수정 전 소스에서 새 테스트 3개가 실패하는지 확인

---

# 체크리스트 — freeze 기본값 끄기와 위험성 문서화 (2026-09-09)

## 배경
- 1.0.7까지 `freeze` 기본값이 `true`였다. 0.1.18에서는 RNS 게이트 때문에 실효가 없었으므로, 업그레이드하는 앱 입장에서는 고지 없이 켜진 셈이었다.
- 무거운 탭 컨텐츠를 매우 빠르게 전환할 때 크래시가 보고됐다.

## 작업
- [x] `FastPager`, `PagerItem` 기본값을 `false`로
- [x] 기본값을 고정하는 테스트 2개 (기본값에서는 미측정 상태로도 전부 마운트 / 비활성 페이지가 계속 리렌더)
- [x] `lazy={false}` 측정 대기 테스트는 `freeze`를 명시하도록 갱신
- [x] README.md, docs/README.ko.md에 `### Freezing Inactive Pages`, `### 비활성 페이지 동결` 추가. 라이프사이클 계약, Fabric 비용 차이, 크래시 보고, 권고
- [x] Props 표의 `freeze` 기본값과 설명 갱신

## 검증
- [x] `yarn test` (43 passed)
- [x] `yarn typecheck`
- [x] `yarn lint`
- [x] 기본값을 `true`로 되돌리면 새 테스트 2개가 실패하는지 확인
