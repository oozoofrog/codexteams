# Mac에서 작업 이어가기

## 현재 0.6.0 — 검증·현재 Pi 적용 완료

현재 작업트리는 `/Users/oozoofrog/.codex/worktrees/teams-session-navigation/codexteams`이며 브랜치는 `task/team-session-navigation`이다. Pi 내부의 프로젝트별 ON/OFF, 일반 입력의 조율·실행·검증·독립 검토·수정, 중간 변경과 재검토를 구현했다. 전체 247개 테스트·typecheck·loader·pack과 실제 Pi의 큰 stdin echo, 기본/큰 payload/중간 변경 RPC, Node 22 설치본 scope 조회가 통과했다. 실제 Sol의 최종 구현 검토와 문서 변경분 검토는 모두 PASS다.

원래 프로젝트 설정을 복원하고 같은 Pi 창 7016에 0.6.0을 적용했다. ON의 일반 질문은 실제 Astra가 처리했고 OFF 후에는 기존 Sol 부모 세션이 일반 입력을 처리했다. 두 모드의 reload 영속성도 확인했다. 현재 기본 화면은 팀 모드 OFF·실행 없음·결과 확인 8개이며 사용자 수락은 하지 않았다. `/teams mode on`이나 기본 화면의 ‘팀 모드 켜기’로 새 일반 요청을 전달할 수 있다.

사용자가 완료 후 commit·push를 요청했다. Root가 현재 작업 브랜치에 변경을 반영한다. main 병합과 전역 설치는 수행하지 않으며 전역 CLI는 0.2.1을 유지한다. 로컬 `.pi/settings.json`과 `.codexteams` 실행 기록은 Git에서 제외한다. 자세한 근거와 검증 한계는 `docs/verification.md`의 0.6.0 절에 있다. 아래 설치 기록은 이전 전달 시점의 기록이다.


최초 설치를 검증한 소스는 `/Volumes/eyedisk/develop/oozoofrog/codexteams`에 있다. Git 초기 커밋은 `95a1e6e`이며 후속 검증과 수정은 `implementation/macos-validation` 브랜치에서 진행했다. ZIP 원본은 보존했고 Git에서 제외했다.

## 현재 확인한 범위

- 0.2.0은 실행 명령과 Pi 확장을 제공한다. 사용자는 Rust 가능성 확인 후 TypeScript 유지를 선택했다. 기존 순차 실행·검토·수락·복구 정책은 유지한다.
- 계획 생성 중 작업 추가로 ID가 충돌하는 결함을 수정했다. 일반 worker·검증 실행 중의 후속 작업 추가는 유지했다.
- macOS 27.2, Node v26.12.1, Pi 1.4.0에서 TypeScript와 자동 테스트 77개가 통과했다.
- 임시 대상과 별도 Pi 설정으로 실제 Mac 설치 스크립트, 로컬 패키지 등록, 실제 CLI 명령, 상태 저장, 종료 후 잠금 해제를 확인했다.
- 실제 사용자의 Pi 설정·인증은 변경하지 않았고 유료 모델 호출도 하지 않았다.
- 세부 결과와 실패 이력은 `docs/verification.md`, 진행 기록은 `docs/progress.md`에 있다.

## 실제 사용자 환경에서 이어갈 단계

1. README의 `npm install -g ... git+https://github.com/oozoofrog/codexteams.git` 명령으로 CLI를 설치하고 `codexteams --version`을 확인한다. `pi install URL`만으로는 실행 명령이 생기지 않는다.
2. 작업할 프로젝트에서 `codexteams`로 상태를 연다. 처음 연결한다면 Pi에서 신뢰·로그인·실제 모델과 역할별 프로필을 확인한다. 기존 인증을 복사하거나 키를 로그에 출력하지 않는다.
3. 새 프로젝트는 `codexteams "목표"` 또는 Pi 안의 `/teams launch <목표>`로 계획과 첫 실행을 시작한다. 기존 프로젝트는 상태를 표시하며 `/teams run`, `/teams resume`, `/teams recover`로 명시적으로 이어간다.
4. 실제 계정의 모델 실행·사용량·취소·재개를 작은 목표로 확인한다. 이 단계는 실제 계정 사용량을 소비하며 로컬 프로토콜 fixture의 성공과 구분한다.

전용 CLI 세션은 다른 자동 발견 확장을 로드하지 않는다. 다른 확장이 제공하는 custom provider가 필요하면 확장 전용 설치 후 일반 Pi에서 사용한다. 표준 입출력이 터미널이 아니면 JSONL을 출력하고, 파이프 텍스트는 목표로 받지 않는다.

## 유지할 설계 경계

- 별도 daemon이나 Codex 실행기를 만들지 않는다. 쓰기 worker는 순차 실행한다.
- 모델의 정상 종료는 `needs_review`다. 사용자 `accept`와 자동 테스트 성공을 구분한다.
- `check`는 사용자가 직접 입력한 shell 명령을 실행하며 worker와 동시에 실행되지 않는다.
- 강제 종료 복구에서 소유권이 확인되지 않은 PID나 그룹을 자동 종료하지 않는다.
- 격리 worktree 병렬 쓰기·자동 통합·자동 수락·모델 자동 승격은 후속 단계다.

상세 설계: `docs/design/2026-11-01-pi-extension.md`. 구현 계획: `docs/plans/2026-11-01-pi-extension.md`.
