# Mac에서 작업 이어가기

## 현재 0.7.0 — 검증·현재 Pi 적용 완료

현재 작업트리는 `/Users/oozoofrog/.codex/worktrees/teams-session-navigation/codexteams`이며 브랜치는 `task/team-session-navigation`이다. `codexteams` 또는 Pi의 `/teams`에서 **새 요청**을 선택한다. 이후 요청 이름으로 진행과 결과를 확인하고 수정·재검증·중단·이어하기·수락을 선택한다. 수락은 별도 확인이 필요하다. ID를 사용하는 수동 명령은 고급 경로로 유지한다.

실제 Astra 설계, GPT 6.1 Terra 단독 구현과 GPT 6.1 Sol 독립 검토를 완료했다. 전체 277개 테스트·typecheck·loader·pack이 통과했고 최종 Sol 소스 검토는 PASS다. 고정 소스의 실제 SDK/scripted TUI 통합 흐름, 자연어 중간 변경의 실제 Pi RPC와 프로세스 종료, Node 22.19 설치본 receipt parity도 통과했다. SDK의 수락은 격리된 synthetic fixture 확인이며 실제 개발 결과 수락은 하지 않았다.

같은 Pi 창 7016에 0.7.0을 적용했다. 120×30에서 새 요청 editor 취소, 실제 Astra의 읽기 전용 답변, 결과와 뒤로 이동을 확인했다. 기존 개발 작업 11개·목표·프로필을 유지했다. 현재 기본 화면은 팀 모드 OFF·실행 없음이며 사용자 수락은 0개다. 새 요청을 시작하면 일반 입력의 팀 접수도 켜는지 확인한다. 프로젝트 실행 설정은 원본과 같고 개인 Pi에 설치된 전역 확장은 0.2.1을 유지한다.

최종 셸 확인에서 `codexteams --version`은 `command not found`였다. 현재 실행 환경의 PATH에서는 CLI 설치를 확인하지 못했다. 설치된 0.2.1은 `~/.pi/agent/git/github.com/oozoofrog/codexteams`의 Pi 확장이다. 기존 Pi의 `/teams`는 프로젝트 설정으로 이 작업트리의 0.7.0을 사용한다. CLI가 필요하면 README의 설치 절차를 별도로 적용한다.

이번 게시 범위는 현재 작업 브랜치의 commit·push다. main 병합과 전역 설치는 포함하지 않는다. `.pi/settings.json`, `.codexteams`와 외부 증거·인증 파일은 Git에 넣지 않는다. 실패 이력과 검증 한계는 `docs/verification.md`의 0.7.0 절에 있다. VoiceOver와 장시간 사용성 수락은 별도다. 아래 설치 기록은 이전 전달 시점의 기록이다.

최초 설치를 검증한 소스는 `/Volumes/eyedisk/develop/oozoofrog/codexteams`에 있다. Git 초기 커밋은 `95a1e6e`이며 후속 검증과 수정은 `implementation/macos-validation` 브랜치에서 진행했다. ZIP 원본은 보존했고 Git에서 제외했다.

## 최초 전달 당시 확인한 범위

- 0.2.0은 실행 명령과 Pi 확장을 제공한다. 사용자는 Rust 가능성 확인 후 TypeScript 유지를 선택했다. 기존 순차 실행·검토·수락·복구 정책은 유지한다.
- 계획 생성 중 작업 추가로 ID가 충돌하는 결함을 수정했다. 일반 worker·검증 실행 중의 후속 작업 추가는 유지했다.
- macOS 27.2, Node v26.12.1, Pi 1.4.0에서 TypeScript와 자동 테스트 77개가 통과했다.
- 임시 대상과 별도 Pi 설정으로 실제 Mac 설치 스크립트, 로컬 패키지 등록, 실제 CLI 명령, 상태 저장, 종료 후 잠금 해제를 확인했다.
- 실제 사용자의 Pi 설정·인증은 변경하지 않았고 유료 모델 호출도 하지 않았다.
- 세부 결과와 실패 이력은 `docs/verification.md`, 진행 기록은 `docs/progress.md`에 있다.

## 실제 사용자 환경에서 이어갈 단계

1. README의 `npm install -g ... git+https://github.com/oozoofrog/codexteams.git` 명령으로 CLI를 설치하고 `codexteams --version`을 확인한다. `pi install URL`만으로는 실행 명령이 생기지 않는다.
2. 작업할 프로젝트에서 `codexteams`로 상태를 연다. 처음 연결한다면 Pi에서 신뢰·로그인·실제 모델과 역할별 프로필을 확인한다. 기존 인증을 복사하거나 키를 로그에 출력하지 않는다.
3. 기본 화면의 **새 요청**에서 내용을 입력한다. 이후 요청 목록에서 상태와 결과를 열고 수정·재검증·중단·이어하기·수락을 선택한다. `launch`와 작업 ID 명령은 고급 수동 경로이며 복구가 필요하면 표시된 복구 안내를 먼저 확인한다.
4. 실제 계정의 모델 실행·사용량·취소·재개를 작은 목표로 확인한다. 이 단계는 실제 계정 사용량을 소비하며 로컬 프로토콜 fixture의 성공과 구분한다.

전용 CLI 세션은 다른 자동 발견 확장을 로드하지 않는다. 다른 확장이 제공하는 custom provider가 필요하면 확장 전용 설치 후 일반 Pi에서 사용한다. 표준 입출력이 터미널이 아니면 JSONL을 출력하고, 파이프 텍스트는 목표로 받지 않는다.

## 유지할 설계 경계

- 별도 daemon이나 Codex 실행기를 만들지 않는다. 쓰기 worker는 순차 실행한다.
- 모델의 정상 종료는 `needs_review`다. 사용자 `accept`와 자동 테스트 성공을 구분한다.
- `check`는 사용자가 직접 입력한 shell 명령을 실행하며 worker와 동시에 실행되지 않는다.
- 강제 종료 복구에서 소유권이 확인되지 않은 PID나 그룹을 자동 종료하지 않는다.
- 격리 worktree 병렬 쓰기·자동 통합·자동 수락·모델 자동 승격은 후속 단계다.

상세 설계: `docs/design/2026-11-01-pi-extension.md`. 구현 계획: `docs/plans/2026-11-01-pi-extension.md`.
