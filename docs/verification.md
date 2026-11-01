# codexteams 검증 기록

## 0.3.0 Codex 인계와 실제 Teams 자체 개선 — 2026-11-01

구현은 `/Users/oozoofrog/.codex/worktrees/codex-teams-handoff/codexteams`에 있다. 원본 checkout의 commit `29405bc`와 추적 파일은 유지했다. 현재 Terminal은 검증된 새 소스의 확장을 명시적으로 로드한다.

| 범위 | 확인한 결과 |
|---|---|
| 실제 Teams 계획 | `openai-codex/gpt-6-astra`, high. 실제 반환 모델 식별자가 요청과 일치했다. |
| 실제 Teams 구현·수정 | 같은 작업·Pi worker 세션에서 `openai-codex/gpt-6.1-terra`, high로 4회 실행했다. 첫 tests-only 결과는 미완료로 보존하고 Sol 검토를 반영해 재개했다. |
| 실제 Teams 독립 검토 | `openai-codex/gpt-6.1-sol`, high로 4회 검토했다. 응답 검증·저장 상태 검증·동시 요청·ENOENT 경계 결함을 수정한 후 마지막 재검토에서 차단 항목이 없음을 확인했다. |
| 최종 자동 검사 | TypeScript와 전체 **160/160**, 실패·skip 0. 실제 Pi 로더, package dry-run, diff whitespace 검사 통과. |
| 실제 controller check | Codex가 Terminal의 `/teams check`로 핵심 회귀 **9/9**를 실행했다. exit 0과 마지막 Terra attempt에 연결된 check 기록을 확인했다. |
| 최소 Node 설치 환경 | Node **22.19.0**에서 실제 tarball을 격리된 global prefix에 설치했다. 물리 Pi peer가 없고 Pi 실행 경로가 없는 환경에서 absent-state 비생성과 저장 결과 조회가 통과했다. 마지막 ENOENT 수정 후 다시 패키징해 확인했다. |
| 실제 계정 인계 | 별도 읽기 전용 fixture에서 새 CLI로 Codex 요청을 제출했다. Sol이 실제 `read` 도구로 README의 prompt에 없던 값을 읽고 반환했다. 재제출·Pi 없는 조회 후에도 attempt는 **1개**였다. |
| 수락 경계 | 제품 작업과 실제 계정 fixture는 `needs_review`로 남았다. 자동 수락은 하지 않았다. 검토 PASS와 사용자 수락을 구분한다. |

실제 모델 사용은 Pi의 공개 응답에서 받은 `effectiveModels`와 usage 기록으로 확인했다. 이는 서버 구현의 별도 attestation이나 청구서가 아니다. 요청한 Normal 서비스 모드의 provider 실행은 별도로 검증하지 않았다.

수정 전 실패는 보존했다. 대표 근거는 `/tmp/codexteams-handoff-red.log`, `review2-red.log`, `enoent-red.log`이며 각각 전체 경로의 공통 접두사는 `/tmp/codexteams-handoff-`다. 마지막 검증 로그는 `/tmp/codexteams-handoff-enoent-final-{focused,typecheck,check,load,pack}.log`다. Codex가 손상된 source root의 조회 우회를 별도 fixture로 재현한 뒤 수정 후 store·조회·CLI 거부 회귀를 확인했다.

지속 보관 근거는 `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-selfhost-0.3.0/`에 있다. `installed-node22-final-result.json`은 최종 설치 검사, `live-verification-result.json`은 실제 계정 인계 검사다. 자동 통합 검사의 local provider fixture와 실제 계정 실행을 구분한다.

요청 파일은 호출자가 관리하는 디렉터리에 둔다. 최종 파일의 nofollow·descriptor identity·bounded read 검사와 CLI→Pi digest 연결을 제공한다. 부모 디렉터리의 원자적 open이나 악성 동일 사용자 프로세스에 대한 OS sandbox는 제공하지 않는다. `source.stopped`는 발신자 선언이며 외부 Codex 프로세스의 정지를 증명하지 않는다. 상세 계약과 사용법은 `docs/design/2026-11-01-codex-handoff.md`, `docs/codex-handoff.md`에 있다.

## 0.2.1 resume picker — 2026-11-01

- `/teams resume`는 Pi의 선택 목록을 연다. 실패·중단·검토 대기 작업만 표시하고 제목·상태·역할·보조 ID로 구분한다. ↑/↓·Enter·Esc로 선택·재개·취소한다. 직접 ID와 수정 지시를 지정하는 기존 방식은 유지한다.
- TypeScript와 전체 테스트 **138개 통과 / 실패 0 / 건너뜀 0**. 새 picker 회귀 21개를 포함한 관련 테스트 32개 통과. 실제 Pi 로더와 패키지 구성 검사도 통과했다.
- 빈 상태·단일 후보·같은 제목·선택 취소·비대화형 목록·신뢰/실행/복구/소유권·선택 중 세션/프로젝트/상태 변경을 검증했다. 독립 검토에서 중대한 picker 결함은 보고되지 않았다. 버전 증가 후 남아 있던 launcher의 0.2.0 기대값을 0.2.1로 수정하고 전체 검사를 통과했다.
- 실제 Pi TTY에서 합성 실패 작업 두 개의 목록을 열고 두 번째 작업을 선택했다. 선택한 designer 역할에만 지정한 존재하지 않는 모델의 preflight 오류로 정확한 대상 라우팅을 확인했다. 다시 목록을 열어 Esc로 취소하고 Ctrl-D로 정상 종료했다. 상태 파일은 전후 바이트가 같고 소유 잠금은 해제됐다. 이 TTY 검증은 실제 모델 재개 실행을 포함하지 않는다.
- 증거: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/resume-picker-0.2.1](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/resume-picker-0.2.1). RED, 중간 버전 실패, 최종 GREEN, TTY 원문·읽기용 기록과 요약을 보존했다.

## 0.2.0 launcher — 2026-11-01

기준 커밋 `7c13df9`에서 실행 명령, 계획·실행 연결과 설치 안내를 추가했다. 환경은 macOS 27.2, Node v26.12.1, Pi 1.4.0이다.

| 검증 | 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, **117개 통과 / 실패 0 / 건너뜀 0** |
| 실제 Pi 로더 | 확장 1개, `teams` 명령과 조회 도구 등록, 오류 0 |
| npm 패키지 구성 | `bin/codexteams.mjs`와 소스 포함. 설치된 명령의 버전 0.2.0 확인 |
| 물리 Pi peer가 없는 설치본 | tarball을 격리 npm prefix에 설치. 실제 Pi와 loopback 프로토콜 fixture로 상태 조회·계획·worker Bash·검토 대기·잠금 해제·기존 상태 보존 통과 |
| 실제 TTY | Pi TUI의 codexteams 안내 표시, Ctrl-D 정상 종료, 프로젝트 상태 생성 없음 |
| 실제 Mac 설치 스크립트 | 별도 대상·npm prefix·Pi 설정에서 복사, 의존성 설치, CLI와 일반 Pi 확장 등록, 버전·조회 확인 |
| 공개 GitHub 설치 명령 | `718aad4` 푸시 후 README의 npm Git 설치를 별도 prefix에서 실행. CLI 0.2.0·소스 일치·실제 Pi 조회 확인. 물리 Pi peer 복사본·모델 호출·프로젝트 상태 생성 없음 |
| 독립 검토 | 세 작업의 요구사항·코드 품질 PASS. 아래 두 지적 수정 후 남은 중대한 결함 없음 |

### 수정한 경계 조건

- 계획부터 첫 작업까지 하나의 취소 단위로 묶었다. 계획 중 추가는 차단하고 실행 중 추가는 허용한다. 계획 직후 취소·종료·소유권 상실 시 worker를 시작하지 않는다.
- 기존 목표·작업·계획 이력은 표시하며 자동 재계획·재시도하지 않는다. 프로필만 설정된 프로젝트는 첫 목표를 시작할 수 있다. 사용자 수락과 복구 확인을 유지한다.
- Pi가 파이프 입력을 초기 slash command 앞에 붙이면 일반 모델 프롬프트가 되는 경로를 발견했다. 비어 있지 않은 비TTY 입력은 Pi 실행 전에 거부한다.
- Pi text print mode는 확장의 custom 메시지를 출력하지 않는다. 비TTY 입출력은 명시적으로 JSONL을 선택한다. 실제 설치본의 조회·실패·완료 출력으로 검증했다.
- 원래 tar 파이프에서 `Write error`를 재현했다. private 임시 archive를 만든 뒤 추출하고 EXIT trap으로 정리하도록 바꿨다. 정확한 기존 파이프 실패 원인은 확정하지 않았다.

전체 RED·중간 실패·GREEN 로그와 TTY 기록: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/launcher-0.2.0](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/launcher-0.2.0). 로컬 프로토콜 fixture는 HTTP 요청 3회로 계획 응답·Bash 도구 요청·최종 응답을 반환했다. 유료 모델이나 실제 계정 인증은 사용하지 않았다.

실제 계정 모델 entitlement·청구, 대화형 TUI에서 목표 실행부터 취소까지의 전체 흐름, Node 최소 버전 22.19.0 자체와 Windows는 검증하지 않았다. TTY 표시와 로컬 프로토콜 성공을 이 범위의 검증으로 확대하지 않는다.

## macOS 후속 검증 — 2026-11-01

대상 소스: `/Volumes/eyedisk/develop/oozoofrog/codexteams`. 원본 초기 커밋은 `95a1e6e`이며 작업 브랜치는 `implementation/macos-validation`이다. Rust 전환 가능성을 검토한 뒤 사용자는 TypeScript 유지를 선택했다.

환경: macOS 27.2 (26B123), Node v26.12.1, npm 11.20.0, Pi 1.4.0. 의존성 122개를 lockfile로 설치했다. Node 최소 지원 버전 22.19.0 자체의 실행은 검증하지 않았다.

| 검증 | 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, **77개 통과 / 실패 0 / 건너뜀 0** |
| `npm run smoke:load` | exit 0. 실제 Pi 로더 오류 0, `teams` 명령과 `codexteams_status` 도구 등록 |
| `npm run pack:check` | exit 0. 패키지 구성 확인, 공개 배포 없음 |
| `git diff --check` | 공백 오류 없음 |
| 실제 Pi host 자동 테스트 | 격리된 설정에 로컬 패키지 등록 후 `help`, `status`, `add`, `profile`, `show` 실행. 상태·프로필 저장과 종료 후 잠금 해제 확인 |
| GitHub URL 설치 안내 | 공개 저장소 URL로 실제 `install`, `list`, `help/status`, `update`, `remove` 통과. 별도 Pi 설정·인증 환경 변수 없는 프로세스 사용. 모델 실행 0회, 프로젝트 상태 생성 없음 |
| 실제 Mac 설치 스크립트 | 임시 대상에 소스 복사, `npm ci`, 격리된 Pi 설정의 패키지 등록 완료. 실제 사용자의 Pi 설정은 변경하지 않음 |
| 독립 코드 검토 | 현재 변경에 중대한 결함 없음. 별도 실행한 controller/runner 테스트 52개 통과. 계획 취소 중 추가 차단·취소 후 추가 허용·검증 실행 중 추가 허용도 확인 |

### 변경과 회귀 검증

- 계획 생성 중 `add`가 같은 작업 ID를 만들면 계획 게시가 실패하고 재시도가 막혔다. 실패 테스트로 재현한 뒤 계획 생성 중에만 추가를 차단했다. 일반 worker와 검증 실행 중에는 추가를 허용한다.
- macOS의 `/var`와 `/private/var`는 같은 폴더를 가리킬 수 있다. worker cwd 테스트가 실제 경로를 비교하도록 수정했다.
- 실제 Pi CLI 통합 테스트는 별도 `PI_CODING_AGENT_DIR`을 사용하며 공급자 인증 환경 변수를 전달하지 않는다. JSONL에 모델 실행 시작이 없고 작업 attempt도 생성되지 않았음을 확인한다.
- 통합 테스트의 첫 실행은 stdin pipe가 열린 채여서 Pi의 EOF 대기 중 timeout이 발생했다. 테스트가 stdin을 닫도록 수정한 뒤 단독 실행과 전체 실행이 통과했다. production 코드는 변경하지 않았다.
- 중간 전체 실행에서 설치 복사 테스트가 한 차례 실패했다. 원인은 확정하지 못했다. 단독 재검사와 이후 전체 76개·77개 테스트 실행은 통과했다. 오류 출력을 assertion에 포함해 다음 실패의 원인을 남기도록 했다.
- 검증 종료 후 background writer가 남을 수 있다는 우려는 12회의 실제 프로세스 관찰에서 재현되지 않았다. 관련 production 코드는 변경하지 않았다.

### 근거와 검증 경계

전체 로그는 다음 폴더에 보존했다: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification). 주요 파일은 `baseline-check.log`, `planning-red.log`, `controller-green.log`, `intermediate-check-installer-failure.log`, `host-test-stdin-failure.log`, `final-check.log`, `macos-install.log`, `registered-host.jsonl`이다. 실패 기록을 삭제하지 않았다.

README의 GitHub 직접 설치 절차는 `remote-install-readme.log`와 `remote-install-readme-summary.json`에 기록했다. 검증한 원격 소스는 `1c3ebff`의 코드이며 이후 변경은 설치 안내 문서다. 이 확인은 원격 설치본의 모델 worker 실행을 검증한 결과가 아니다.

macOS CLI·프로세스 그룹·설치·상태 저장 검증을 실제로 실행했다. 대화형 TUI의 시각적 사용성, 실제 사용자의 Pi 등록·reload, 로그인 계정 모델 호출·entitlement·청구는 확인하지 않았다. 유료 모델 호출과 외부 게시를 하지 않았다. 병렬 worktree, 자동 수락, 자동 모델 배정과 Ultra 전략은 기존 후속 범위로 남긴다.

## 이전 Linux 전달본 기록

검증일: 2026-11-01. 대상: 이 소스 패키지의 첫 Pi 확장 구현.

### 최종 결과

| 검증 | 실제 실행 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, 테스트 **74개 통과 / 실패 0 / 건너뜀 0** |
| `npm run smoke:load` | exit 0. 실제 Pi 로더에서 확장 1개, `teams` 명령, `codexteams_status` 도구 등록. 로딩 오류 0 |
| worker 전용 guard 로딩 | 위 74개 테스트에 포함. 실제 Pi `DefaultResourceLoader`에서 discovery 비활성화 + 명시적 guard 로딩, Bash override만 등록 |
| `NPM_CONFIG_CACHE=/tmp/codexteams-npm-cache npm run pack:check` | exit 0. npm 패키지 구성 확인. 공개 배포하지 않음 |
| Mac 설치 스크립트의 소스 복사 | Linux의 `--copy-only` 테스트 통과. 새 폴더 생성, 의존성·Git 이력 제외, 기존 프로젝트 덮어쓰기 거부 확인 |
| `git diff --check` | 공백 오류 없음 |

실제 Pi 로더 출력은 `docs/load-smoke-result.json`에 보관했다. npm 패키지 점검은 설치용 파일 집합 검사다. 사용자에게 전달하는 ZIP은 개발을 이어갈 수 있도록 테스트·TypeScript 설정·lockfile도 포함한 전체 소스다.

### 실행 환경

- Linux, Node 24.22.1. 패키지가 선언한 최소 Node 버전은 22.19.0이며, 최소 버전 자체를 별도로 실행 검증하지는 않았다.
- `@earendil-works/pi-coding-agent` 1.4.0, `@earendil-works/pi-ai` 1.4.0.
- TypeScript 5.9.3, TypeBox 1.3.27. 의존성은 `package-lock.json`으로 고정.
- 프로세스 정리 검증과 최종 전체 테스트는 실제 OS PID/PGID를 제공하는 승인된 실행 경로에서 수행했다.
- 기본 관리 환경에서는 Node PID와 OS `ps` 정보가 다르고 child 출력 전달이 제한되는 현상을 확인했다. 실패한 `ps` 조회를 '프로세스가 종료됨'으로 간주하지 않도록 테스트를 수정했다. production의 소유권 확인 조건은 약화하지 않았다.
- npm 패키지 점검의 기본 캐시 경로는 쓰기 불가능했으므로 쓰기 가능한 임시 캐시 경로를 명시해 성공시켰다. 소스 결함이나 배포 실패로 처리하지 않는다.

### 검증한 동작

1. 목표 → 읽기 전용 계획 → 엄격한 JSON/DAG 검증 → 작업 저장 → 실행 → 검토 대기 → 사용자 수락 → 의존 작업 해제.
2. 역할별 명시적 모델·effort, capability 실패 시 호출 방지, `ultra`를 실제 effort로 보내지 않음.
3. 동일 프로젝트 소유자 잠금, 원자적 저장, 손상 상태 보존, symlink 거부, 중첩 실행 기록 검증.
4. 실패·취소·강제 종료 복구, 새 attempt로 수정 재개, 실행 당시 프로필과 이전 시도 보존.
5. 실제 subprocess의 JSONL, 분할 UTF-8, 정상 exit에 포함된 모델 오류, 불완전 출력, 출력 크기 경계, 자식 실행 실패.
6. 실제 Pi BashToolDefinition의 native 결과 형태, shell 설정·환경·cwd 보존, 일반 백그라운드 자식 정리, 도구 취소·명시적 timeout의 전체 attempt 종료.
7. 검증 shell의 실제 종료 코드·출력·취소와 background pipe 정리. worker와 검증의 동시 쓰기 차단.
8. assistant 최종 사용량만 합산, 스트리밍 중복 제외, reasoning 이중 합산 방지, 실패·중단의 미확인 사용량 보존, 실행 중 부분 합계 저장.
9. 직접 사용자 명령에만 실행·검증·수락을 제공하고, 모델에 노출되는 조회 도구는 읽기 전용으로 유지.

### 독립 검토에서 수정한 결함

| 재현한 결함 | 수정과 회귀 검증 |
|---|---|
| native Pi Bash의 일반 background process가 worker 그룹에서 빠져나가 작업 후에도 남음 | private guard가 검증된 worker 그룹을 상속하는 Bash operations를 사용. 실제 native 도구 기반 실패 재현 후 정상 완료·취소·timeout 사례 통과 |
| 검증 shell은 종료됐지만 background child가 pipe를 잡아 `close`가 오지 않음 | shell `exit`에서 정리를 시작하고 실제 `close`까지 확인 |
| 중첩 attempt/check 손상과 미완료 attempt의 외부 status 불일치가 복구를 우회 | 중첩 필드·참조·관계 검증, outer status와 독립적으로 미완료 attempt 복구 판정 |
| 복구 대기 중 작업을 수락할 수 있음 | recoveryRequired 동안 accept 차단 |
| 취소와 저장 오류가 동시에 발생할 때 실패가 가려질 수 있음 | 이미 확인된 실패 분류 보존 |
| 진행 중 확정된 응답 사용량이 최종 종료 전 상태 파일에 남지 않음 | 응답 완료마다 partial 합계를 저장 |

최종 guard 범위의 독립 검토에서는 남은 Important/Critical lifecycle·ownership 결함이 보고되지 않았다. 이는 아래 미검증 환경까지 보장한다는 뜻은 아니다.

### 아직 검증하지 않은 사항

- 사용자 Mac의 `eyedisk/develop/codexteams` 생성·설치, 실제 macOS TUI 표시·상호작용.
- 사용자 계정의 Terra/Sol/Astra entitlement, 실제 로그인 모델 호출, 공급자 청구/플랜 차감.
- 실제 디스크 관리 앱 전체 구현. README의 디스크 앱은 사용 시나리오다.
- macOS 자체의 프로세스 그룹 동작과 Windows 프로세스 트리. 첫 실제 Mac 실행에서 확인할 항목이다.
- 악의적 `setsid` 등 의도적인 프로세스 그룹 이탈 방어. 이 확장은 OS sandbox가 아니다.
- 병렬 worktree 통합, 자동 인수 판정, 자동 난도 판정·모델 승격, Ultra 전략. 현재 구현 범위에 포함하지 않았다.

테스트와 로더 검증에서는 유료 모델 호출, 사용자 인증 변경, 외부 저장소 게시를 하지 않았다. 다음 실제 실행 단계는 `docs/WORK_HANDOFF.md`에 정리했다.
