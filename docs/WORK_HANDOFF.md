# Mac에서 작업 이어가기

소스는 `/Volumes/eyedisk/develop/oozoofrog/codexteams`에 있다. Git 초기 커밋은 `95a1e6e`이며 후속 검증과 수정은 `implementation/macos-validation` 브랜치에서 진행했다. ZIP 원본은 보존했고 Git에서 제외했다.

## 현재 확인한 범위

- 순수 Pi 확장 0.1 구현을 유지한다. 사용자는 Rust 가능성 확인 후 TypeScript 유지를 선택했다.
- 계획 생성 중 작업 추가로 ID가 충돌하는 결함을 수정했다. 일반 worker·검증 실행 중의 후속 작업 추가는 유지했다.
- macOS 27.2, Node v26.12.1, Pi 1.4.0에서 TypeScript와 자동 테스트 77개가 통과했다.
- 임시 대상과 별도 Pi 설정으로 실제 Mac 설치 스크립트, 로컬 패키지 등록, 실제 CLI 명령, 상태 저장, 종료 후 잠금 해제를 확인했다.
- 실제 사용자의 Pi 설정·인증은 변경하지 않았고 유료 모델 호출도 하지 않았다.
- 세부 결과와 실패 이력은 `docs/verification.md`, 진행 기록은 `docs/progress.md`에 있다.

## 실제 사용자의 Pi에서 이어갈 단계

1. 현재 소스 폴더에서 `pi install "$PWD"`로 패키지를 등록한다. 기존 인증을 재사용하고 키나 토큰을 로그에 출력하지 않는다.
2. Pi를 다시 열거나 `/reload`한 뒤 `/teams help`, `/teams status`를 확인한다. CLI 자동 테스트는 대화형 TUI의 시각 검증을 대신하지 않는다.
3. 사용자가 지정한 프로젝트에서 실제 provider/model과 지원 effort를 확인한다. 작은 목표로 실제 실행, 사용량, 취소와 재개를 확인한다. 이 단계는 실제 계정 사용량을 소비한다.

## 유지할 설계 경계

- 별도 daemon이나 Codex 실행기를 만들지 않는다. 쓰기 worker는 순차 실행한다.
- 모델의 정상 종료는 `needs_review`다. 사용자 `accept`와 자동 테스트 성공을 구분한다.
- `check`는 사용자가 직접 입력한 shell 명령을 실행하며 worker와 동시에 실행되지 않는다.
- 강제 종료 복구에서 소유권이 확인되지 않은 PID나 그룹을 자동 종료하지 않는다.
- 격리 worktree 병렬 쓰기·자동 통합·자동 수락·모델 자동 승격은 후속 단계다.

상세 설계: `docs/design/2026-11-01-pi-extension.md`. 구현 계획: `docs/plans/2026-11-01-pi-extension.md`.
