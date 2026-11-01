# 팀·작업 세션 탐색과 실행 유지

사용자는 팀 세션 아래에 작업 세션을 묶어 상태와 기록을 보고 이동하도록 설계·구현하라고 요청했다. 화면을 옮겨도 실행 중인 작업을 유지해야 한다. 이전과 같이 실제 Terminal에서 Teams가 Astra 계획 → GPT 6.1 Terra 구현·수정 → GPT 6.1 Sol 독립 검토를 수행한다. Codex는 설계·조정·인수 검증을 맡는다. 모델 추론은 high를 요청한다. 기존 Codex 세션 설정과 사용자 인증을 변경하지 않는다. 이 기능은0.4.0이다.

## 기준과 선택

기준은 검증된0.3.0 commit `b675088`이다. 이 소스는 `/Users/oozoofrog/.codex/worktrees/codex-teams-handoff/codexteams`에서 고정 실행한다. 제품 변경은 `/Users/oozoofrog/.codex/worktrees/teams-session-navigation/codexteams`에만 쓴다. 새 작업 공간의 TypeScript와160개 검사는 통과했다. 기존0.3.0의 인계·중복 억제·검토·수락·복구 동작을 보존한다.

단순한 `ctx.switchSession()` 추가는 현재 session_shutdown이 worker를 취소하므로 요구를 충족하지 못한다. 별도 daemon은 불필요하다. Pi 프로세스가 실행 컨트롤러를 보유하고 세션 화면은 새 context로 붙는 방식을 사용한다. 원본 worker JSONL을 다른 Pi 화면의 쓰기 세션으로 열지 않는다. 부모·작업 조회 세션을 Pi SDK로 만들고 원본 기록을 읽어 표시한다. 실제 worker와 조회 세션의 연결을 명확히 표시한다.

## 사용자 흐름

`/teams sessions`는 현재 프로젝트와 현재 Pi 프로세스에서 연결한 팀을 트리로 보여준다. 이 목록을 모든 기기의 모든 팀이라고 표시하지 않는다. 홈 폴더나 무관한 프로젝트의 transcript를 전역 검색하지 않는다. 다른 프로젝트의 팀은 사용자가 해당 프로젝트 세션으로 이동해 명시적으로 연결한 뒤 목록에 포함한다. 팀 데이터가 없으면 실제 빈 상태와 기존 시작 방법을 표시하며 상태를 만들거나 모델을 호출하지 않는다.

각 팀 아래에 계획·작업 세션을 표시한다. 각 항목에 이름, 실제 작업 상태, 역할, 요청 모델·추론과 반환 모델, 최근 활동을 표시한다. 일반 task의 재시도는 같은 worker 대화를 사용하므로 새 세션으로 꾸미지 않고 실행 이력으로 묶는다. planningAttempt에는 task ID가 없으므로 kind/planningAttempt ID/workerSession ID로 식별한다. 계획 재시도의 worker ID가 실제로 다르면 그 관계를 그대로 보존한다. 미응답·파일 준비 중·누락·중단·복구 필요를 구분한다. 상태는 ProjectState와 보유 컨트롤러에서 읽는다.

↑/↓로 항목을 고르고 Enter로 조회 세션을 연다. Esc는 현재 조회에서 팀 화면으로, 목록에서는 이전 화면으로 돌아간다. 명시적인 `/teams home`도 제공한다. ID를 외우지 않고 선택할 수 있어야 한다. `/teams open <task-id>` 같은 명시적 진입점은 자동 테스트와 재현에 사용할 수 있다. 이름이 같아도 내부 ID로 정확히 매핑한다. 취소는 모델·파일·task 상태 변경을 만들지 않는다. root/child 파일 생성과 metadata 연결은 선택 확정 뒤에만 수행한다. 비대화형 `/teams sessions`는 목록과 사용 가능한 명시적 구문만 출력하며 세션을 선택하거나 만들지 않는다.

작업 조회에서는 실제 공개 대화·도구 실행 기록과 최근 결과, 실행 이력, 검증 기록을 볼 수 있다. 실행 중에도 기록이 갱신된다. 조회 대상과 기준 팀, 돌아갈 위치를 항상 식별할 수 있어야 한다. 동작에 필요한 상태와 버튼을 우선하고 긴 기능 설명으로 화면을 채우지 않는다. 기존 작업 재개·검증·수락은 팀 화면의 명시적 명령으로 유지한다. 조회 화면에서 일반 모델 대화를 시작하거나 작업 파일을 변경하지 않는다.

## 프로세스 소유 실행

포커스가 없는 동안에도 TeamController, AbortController, worker promise, ProjectStore 소유권을 유지한다. Pi는 세션 교체 때 확장을 새 module graph로 로드하므로 모듈 지역 singleton으로 구현하지 않는다. `globalThis`의 versioned Symbol 레지스트리를 사용하고 canonical extension source identity와 project root로 소유자를 구분한다. 호환되지 않는 레코드를 조용히 초기화하거나 다른 코드 소유자로 바꾸지 않는다. 기존 instance를 새 module graph의 `instanceof`로 판정하지 않는다.

- session_shutdown reason `new`, `resume`, `fork`: 기존 화면·observer를 동기적으로 분리한다. worker·check·queue를 취소하거나 기다리지 않고 소유권을 유지한다.
- session_start: 새 context로 해당 프로젝트의 화면을 연결한다. 이전 세션의 ctx·pi·ui·epoch를 다시 사용하지 않는다. 현재 화면과 다른 프로젝트의 이벤트를 잘못 표시하지 않는다.
- reason `quit`, `reload` 또는 알 수 없는 최종 종료: 레지스트리의 모든 보유 컨트롤러를 정리한다. 현재 화면의 프로젝트만 정리하고 다른 팀을 남기지 않는다. 하나가 실패해도 다른 소유자의 정리를 시도하고 불확실한 결과를 보존한다. 중복 종료는 안전해야 한다.

오래된 `operation`·handoff 완료 callback도 새 화면의 표시 연결로 라우팅하거나 저장 결과만 남겨야 한다. 화면 교체 후 stale context 예외가 실행 결과를 실패로 바꾸거나 검토 결과를 유실하지 않아야 한다. 조회 component의 timer·subscriber는 닫을 때 제거한다. 표시 오류는 실행을 취소하지 않는다.

프로필 검증은 살아 있는 context에서 얻은 **bare ModelRegistry**를 프로젝트별로 보유해 수행할 수 있다. pinned Pi1.4.0은 AgentSession.dispose에서 ModelRuntime을 폐기하지 않고 해당 facade의 find/hasConfiguredAuth에 stale-context guard가 없다. 오래된 ctx getter를 다시 호출하지 않는다. 새로 신뢰한 같은 프로젝트 context가 생기면 registry를 갱신한다. 다른 프로젝트의 registry로 재바인딩하지 않는다. 조회·인증·effort 확인이 실패하면 다음 dispatch를 막고 현재 실행 중인 외부 worker는 화면 이동 때문에 중단하지 않는다. 모델·effort·인증 경로를 자동 대체하지 않는다. 별도 모델 서비스나 인증 파일 복사는 필요 없다.

## 다른 프로젝트로 이동할 때의 정리 보장

전용 launcher의 명시적 `-e` 경로는 Pi 세션의 cwd가 바뀌어도 유지된다. 이 관리 모드에서는 같은 확장이 새 세션에 다시 로드되므로 여러 연결 팀의 실행을 유지하고 최종 quit에서 모두 정리할 수 있다. 필요한 경우 확장 등록 flag를 launcher가 전달하되 실제 absolute explicit extension 선택과 discovery 비활성화를 검증해 관리 모드를 구분한다. 일반 Pi의 전역 설정을 수정하지 않는다.

프로젝트 전용 자동 발견 확장은 다른 프로젝트로 이동하면 사라질 수 있다. 이 경우 active owner가 남아 있는데 확장 없는 대상으로 떠나도록 두지 않는다. 같은 프로젝트 이동은 지원한다. 정리를 보장할 수 없는 다른 프로젝트 이동은 작업을 취소하는 대신 전환을 막고 전용 launcher 경로를 안내한다. 보유 소유자가 모두 idle이면 안전하게 release한 뒤 이동할 수 있다. 이 제한을 문서와 실제 검사에서 명시한다. process.exit를 monkey-patch하거나 확인되지 않은 PID를 종료하는 대안은 사용하지 않는다.

## 팀·조회 세션 관계

ProjectState schemaVersion=1에 선택적 navigation metadata를 추가한다. 기존 상태는 계속 읽는다. 최소한 팀 root session의 ID·file, 조회 session의 kind와 task/planningAttempt ID·session ID·file·parent 연결과 worker session ID를 보관한다. 같은 작업의 실행 이력과 원본 worker session ID는 기존 Attempt가 소유한다. 공유 state-validation.mjs에서 자료형·중복 ID·작업/계획 연결·경로 구조를 검사해 단독0.3.0 결과 조회가 설치된 node_modules의 TypeScript를 import하지 않도록 유지한다.

목록은 현재 보유 컨트롤러와 현재 프로젝트 상태를 합쳐 만든다. 등록되지 않은 경로·파일명·제목 유사도로 세션을 추측하지 않는다. 파일이 없다는 이유로 실행 이력을 지우거나 task를 성공/실패로 바꾸지 않는다. 세션 열기 직전에 current context epoch, 선택한 owner의 root/project ID, task/session ID, 대상 header의 cwd·ID·parent 관계와 소유권을 재확인한다. 목표 root는 outgoing ctx.cwd가 아니라 선택한 연결 팀의 root와 일치해야 한다. 따라서 관리 모드의 A팀→B팀 이동을 막지 않으면서 잘못된 root·바뀐 대상 매핑을 거부한다. 일반적인 worker 진행 갱신만으로 readonly 선택을 무효화하지 않는다. 경로가 symlink·특수 파일·다른 세션이면 거부하고 실행은 유지한다.

Pi의 parentSession metadata와 native threaded picker를 재사용한다. 팀 root와 작업 조회 파일을 같은 지정/default Pi session directory에 만들면 native `/resume`에서도 부모·자식 관계를 인식할 수 있다. `.codexteams/sessions`의 실제 worker 파일은 native 쓰기 전환 대상에서 제외한다. 원본 worker와 조회 파일의 차이를 숨기지 않는다.

명령만 실행한 Pi root는 아직 파일이 없을 수 있다. path 문자열만 저장하고 돌아갈 수 있다고 표시하지 않는다. 기존 살아 있는 root session 파일이 실제로 있고 cwd·ID가 맞으면 연결한다. 없으면 공개 SessionManager SDK로 별도 팀 root를 만든다. 실제 사용자 목표/실제 탐색 명령을 user 기록으로 남겨 영속화하고, 필요하면 provenance가 있는 custom entry/message를 더한다. 가짜 assistant 응답이나 실제로 하지 않은 모델 호출을 만들지 않는다. JSONL을 수동으로 조작하거나 SDK private `_persist`를 호출하지 않는다. `--no-session`의 임시 부모에서는 영속 파일을 몰래 만들지 말고 조회 패널/정확한 제한 안내를 제공한다.

작업 조회 세션도 SDK로 만들고 `parentSession`으로 root와 연결한다. 실제 선택 동작과 task 참조를 기록해 영속화한다. 조회 자체는 모델을 호출하지 않는다. 새 파일은 해당 Pi의 sessionDir 선택을 존중하고 private 권한을 사용한다. SDK 기본 mode를 private 보장으로 간주하지 않는다. 자신이 새로 만든 파일/디렉터리에만 private mode를 적용하고 기존 공유 sessionDir의 권한은 변경하지 않는다. 원본 worker JSONL은 read-only parser로만 읽는다. 이름·model 설정을 바꿔 쓰기용 두 번째 worker로 위장하지 않는다. 같은 task의 조회 세션은 가능하면 재사용하되 오래되거나 누락된 파일은 정확히 안내한다.

## 조회 화면의 경계

native 세션 전환은 team root ↔ 전용 조회 세션 사이에서 수행한다. 새 runtime의 신뢰·model/UI bindings와 withSession context를 사용한다. 원본 worker 파일을 SessionManager.open 또는 switchSession으로 여는 것을 막는다. native `/resume` 등에서 알려진 worker 파일을 선택해도 navigation 경로로 유도한다.

조회 화면은 `ctx.ui.custom` 등 지원되는 TUI로 공개 user/assistant text와 tool 상태·공개 결과를 표시한다. custom TUI는 `ctx.mode === "tui"`에서만 연다. RPC는 hasUI가 true여도 ui.custom을 지원하지 않으므로 비TUI에서는 비변경 목록/명확한 안내를 제공한다. hidden thinking/reasoning 내용을 표시하지 않는다. active 파일의 불완전한 마지막 JSONL 줄, 큰 기록, Unicode, missing 파일을 안전하게 다룬다. 읽기는 bounded/paged이며 일부만 표시하면 범위를 밝힌다. 원본 파일을 migrate/rewrite하지 않는다. 화면이 닫히면 live polling을 멈추며 worker는 계속 실행한다.

조회 모드는 일반 prompt를 handled로 막고, 임의 tool_call과 user_bash를 막는다. Teams 명령은 목록·상태·상세·팀 복귀 등 조회/이동 allowlist로 제한한다. 수정·재개·수락은 팀 화면에서 수행한다. native 세션 관리 명령은 조회 파일에만 영향을 주며 원본 worker 파일에는 쓰지 않는다. clone/fork가 조회 marker를 가져가면 read-only 경계를 유지한다. 이 경계는 전용 단일 확장에서의 지원 동작이며 악성 확장·같은 사용자 프로세스에 대한 OS sandbox를 주장하지 않는다.

## 개발과 검증

고정0.3.0 Teams의 새 프로젝트에서 Astra가 한 coherent developer 작업을 계획하고 Terra가 구현한다. Sol은 현재 파일과 실제 로그를 읽어 독립 검토한다. 같은 task/session에 수정 근거를 전달해 재개하며 실패를 지우지 않는다. 정상 모델 종료와 구현 완료·검토 PASS·사용자 수락을 구분한다. 조회·목록·화면 이동으로 수락/재개/모델 호출이 발생하지 않아야 한다.

필수 회귀:

1. 실제 pending worker와 pending check가 new/resume/fork를 건너 계속 실행하고 quit/reload에서 정리된다. 새 확장 인스턴스가 같은 process owner를 찾으며 stale ctx/observer를 쓰지 않는다.
2. 같은 프로젝트 잠금 소유권 유지, 다른 소유자 거부, 여러 보유 root의 최종 정리, source/schema 충돌 fail-closed, 프로젝트 전용 확장의 위험한 cross-root 이동 차단.
3. 목록의 올바른 hierarchy·실제 상태·모델·실행 이력, 이름 중복의 정확한 ID 선택, 취소/빈 상태/headless 비생성, 누락/손상 session, stale 선택, parent file 실재성, 임시 세션 privacy.
4. 원본 worker 파일의 bytes·inode·mtime이 조회 때문에 바뀌지 않고 두 번째 model worker가 생기지 않는다. hidden reasoning을 표시하지 않고 partial line/큰 Unicode 기록을 처리한다. 실제 readonly guards와 subscriber cleanup을 검사한다.
5. SDK-created root/child의 parentSession 관계, 팀 복귀, native picker가 포함할 수 있는 session directory, 기존0.3.0 인계·설치 Node22.19·전체 회귀를 보존한다.
6. 실제 Pi module-replacement 통합 검사와 실제 Terminal 동작을 사용한다. 단순 mock이나 빌드 통과를 화면 이동 중 실행 유지의 증거로 주장하지 않는다. 유료 모델은 실제 Teams 개발/최소 live 검증에 사용하고 자동 테스트는 local protocol fixture를 사용한다.

Root는 최종 쓰기 중단 후 현재 검토·필수 검사·원본 source 보존·패키징을 확인하고 실제 Terminal에서 실행 중 작업 → 다른 조회/팀 화면 → 복귀를 관찰한다. 전역 설치·push·배포는 범위에 포함하지 않는다. user 모델과 Normal 요청을 보존하되 provider runtime tier는 확인된 근거 범위에서만 보고한다.
