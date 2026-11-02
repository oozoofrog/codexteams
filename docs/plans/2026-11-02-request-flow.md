# ID 없는 요청 흐름 구현·검증 계획

> For agentic workers: preserve the user-selected actual Pi Teams execution method. Actual Astra designs, actual GPT 6.1 Terra is the sole product writer, and actual GPT 6.1 Sol independently reviews after writing stops. Root coordinates authorized internal decisions; do not create other chats or replace these roles.

**목표:** ID나 내부 단계 없이 새 요청·진행·결과·수정·재검증·중단·재개·명시적 수락을 끝낸다.

**구조:** 기존 controller/supervisor를 유지하고 요청 중심 투영, 공통 행동/guard와 UI 진입을 추가한다. 수락은 기존 검토 근거 검사를 보존한 단일 store update다.

**기술:** TypeScript, Pi SDK 1.4.0, Node >=22.19, 기존 node:test/tsc와 packaged JavaScript validator.

**설계:** `docs/design/2026-11-02-request-flow.md`. 실제 Astra의 근거는 외부 `codexteams-request-flow-070/astra-design.md`다.

## 전역 제약

- 기준 HEAD `8cd87f6`, 0.6.0 전체 247개 회귀와 a12 runtime 근거. 완료된 0.6.0을 재시작하지 않는다.
- 실제 Terra는 src/bin/tests/package/lock/README와 사용자 문서를 작성한다. Root의 design/plan/progress/verification/WORK_HANDOFF와 `.pi/settings.json`은 수정하지 않는다.
- 같은 canonical source path와 같은 Pi 창 7016을 유지한다. 작성/검토 중 /reload, 다른 snapshot 선택, settings/auth/global install, 사용자 결과 수락은 하지 않는다.
- ID·role·checkpoint를 몰라도 기본 흐름이 끝나야 한다. 명시적 고급 명령은 보존한다. 실제 상태·동의·원본 worker/legacy 작업·순차 실행·owner/trust/recovery·OFF 의미를 유지한다.
- 0.7.0으로 package/lock/launcher version assertions/README를 일치시킨다. 전역 CLI나 main은 변경하지 않는다. commit·push는 Root가 최종 검증 후 수행한다.
- 테스트에서만 상속 CODEXTEAMS 실행 변수를 격리한다. 현재 worker의 guard/owner를 제거하지 않는다. 광범위 홈 검색·환경 덤프·권한 우회·nested models는 금지한다. 실제 실패 로그를 보존한다.

## 검토 집중 대상

1. 같은 제목과 변경된 목록: 제목/순서로 target을 추측하지 않는다. 화면 교체·request revision·mode/owner/trust·실행/evidence 변경은 stale mutation을 거부한다.
2. 실제 결과 수락: 원본 PASS/check/scope/artifact gate와 명시적 확인을 유지하며 request+writer receipt를 원자적으로 기록한다. 실패·취소·중복에 부분 수락이 없어야 한다.
3. 중단/재개 간격: activeOperation이 잠시 없어도 request execution이 끝나지 않았으면 겹쳐 실행하지 않는다. Home stop이 다음 managed 단계로 이어지지 않는다.
4. 재검증과 수정: 재검증은 writer를 실행하지 않으며 changes_required면 멈춘다. 수정은 실제 지시를 scope에 연결하고 writer→check→review를 수행한다.
5. 과거 수락/없는 상태/headless: 0.6 accepted-writer read는 조회에서 state/receipt를 만들지 않는다. 빈 입력·취소는 state/model을 만들지 않는다. headless 무ID는 후보를 선택하지 않는다.

## 하나의 완결 구현 작업 — 실제 Terra task-10

**주요 파일:** `src/core/{controller,team-mode,types,store}.ts`, `src/core/state-validation.{mjs,d.mts}`, `src/ui/home.ts`, `src/ui/format.ts`, `src/index.ts`. 필요하면 요청 투영/행동을 `src/ui/request-view.ts`, `src/ui/request-flow.ts` 같은 집중된 모듈로 분리한다. 실제 책임에 맞춰 파일 이름은 Terra가 정하고 최종 결과에 기록한다.

**공통 인터페이스:** 요청별 activity snapshot/coordinator/execution 소유 관계, 순수 request view/capability projection, immutable request-action fence, UI/command 공통 dispatcher를 제공한다. `TeamController.acceptRequest(fence)`에 상당하는 authoritative 원자적 수락을 두고 기존 `accept(taskId)`도 managed 요청은 같은 경로로 보낸다. `TeamModeSupervisor`에는 명시적 revise/recheck와 request-scoped settlement guard를 제공한다. 이름이 달라져도 설계의 동작/검증 책임은 유지한다.

- [ ] 단계 1: atomic acceptance/receipt+legacy projection의 행동 RED를 작성하고 실패 로그를 보존한다. 기존 current evidence gates, pending amendment, persistence failure/duplicate/tampered receipt도 검사한다.
- [ ] 단계 2: 타입/validator/packaged parity와 controller acceptance를 완성한다. 과거 accepted-writer는 읽기 전용으로 인정하고 resume/recheck/reaccept에서 제외한다. render 중 migration하지 않는다.
- [ ] 단계 3: request stop/resume/revise/recheck의 실제 행동 RED 후 구현한다. 종료 settlement, OFF/재시작의 no-auto-resume, waiting-result 수정→writer 재실행, recheck→changes_required의 no-write를 검증한다.
- [ ] 단계 4: 요청 중심 Home/결과/행동과 no-ID command 경로의 행동 RED 후 구현한다. 새 요청은 ingestion으로 보내고 manual tasks는 별도 화면에서 유지한다. answered/blocked/accepted 요청도 표시하고 reviewer 중복 row/count를 없앤다. 실제 query/수정/수락/확인 취소/동일 제목/stale editor/confirmation/owner/root/session/readonly를 검사한다.
- [ ] 단계 5: 기본 접수/상태/완료 문구를 실제 상태와 다음 행동으로 연결한다. 기존 session navigation, worker/check continuation과 원본 기록 불변 회귀는 유지한다. 기존 UI 테스트가 바뀌면 경로만 갱신하고 핵심 assertion을 제거하지 않는다.
- [ ] 단계 6: 하나의 통합 ID-free 시나리오를 public Pi SDK/UI component 경로에서 검증한다. 새 요청→actual worker/check/review→수정 또는 재검증→결과→확인 취소→명시적 synthetic fixture 수락을 포함한다. 실제 모델/물리 키/시뮬레이션/사용자 수락 근거를 구분한다. 별도 interactive Pi를 열지 않는다. Root의 외부 native-ui-proof와 중복 실행하지 말고 자신의 focused regression과 SDK 경로를 보고한다.
- [ ] 단계 7: README/사용자 안내·version을 갱신하고 `npm run check`, `npm run smoke:load`, `npm run pack:check`, `git diff --check`를 한 번의 최종 coherent 상태에서 통과시킨다. focused/RED/GREEN/full 로그를 고유 경로로 보존한다. 작성이 끝나면 모든 쓰기를 멈추고 최종 파일·interface·한계·로그를 보고한다.

## Root 검증과 독립 검토

1. Terra가 멈춘 현재 소스의 manifest를 고정한다. 실제 Sol task-11이 설계/현재 diff/실제 근거를 독립 검토한다. 실패는 같은 Terra 작업으로 구체적 rework를 전달하고 보존한다.
2. source hash/247+새 회귀/typecheck/loader/pack을 확인한다. 외부 실제 Pi SDK+scripted TUI+loopback native worker proof를 frozen source에서 실행한다. UI client는 visible label/key/confirm만 사용하며 ID나 private controller/supervisor로 진행시키지 않는다. provider가 실제 native tool을 대신해 state/artifact를 쓰지 않는다.
3. Node22 격리 설치본으로 새 acceptance metadata의 ProjectStore/packaged reader parity와 tampered receipt 거부를 확인한다. 원본 proof state는 변경하지 않는다.
4. 모든 writer/reviewer가 멈춘 뒤 같은 Pi를 /reload한다. 120×30의 새 요청/목록/상태/답변/결과/뒤로/확인 취소를 관찰한다. 실제 개발 결과는 자동 수락하지 않는다. 인증/전역 설치 변경과 추가 interactive Pi는 없다.
5. Root 문서와 실제 제한을 갱신한다. 사용자 편의성·VoiceOver·실제 장시간 작업의 수락을 자동 테스트 PASS로 대체하지 않는다. 최종 commit·push와 원격 HEAD 일치를 기록한다.


## 같은 owner의 검토 후 수정

현재 a5는 252개/typecheck/loader/pack PASS와 외부 native UI/midwork/Node22 기술 PASS가 있으나, Sol의 7개 source finding 때문에 제품은 미완료다. 실제 Terra task-10에서 새 행동 RED→수정→GREEN을 수행하고 기존 assertion을 유지한다. 특히 public SDK extension command reinjection, 동일 panel의 live update/Back/Esc, 관련 없는 operation 완료와 관련 결과 변경의 대조, 자연어 stop의 unresolved worker, Home mode await 뒤 context 교체, OFF 행동과 linked detail을 검사한다. README/안내의 과거 기본 흐름도 수정한다.

Root가 고정한 a5 소스와 최초 실패/어댑터 수정/기술 PASS는 당시 근거로 보존한다. 새 source가 멈춘 뒤 새 manifest와 case ID로 필요한 검증을 실행하고, 실제 Sol 같은 task-11에 current evidence 재검토를 요청한다. 반복 횟수 제한이나 자동 수락은 없다.
