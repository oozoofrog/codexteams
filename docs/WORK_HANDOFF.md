# ChatGPT Work에서 Mac 설치 이어가기

이 패키지는 `codexteams` 순수 Pi 확장의 상세 설계와 실제 0.1.0 구현이다. 이전 대화는 사용자의 Mac `eyedisk/develop/codexteams`에 접근할 수 없는 Linux 실행 환경이었다. 해당 Mac 폴더에 아직 생성·설치되지 않았다.

## 사용자가 이미 승인한 목표

- 상세 설계를 작성하고 `eyedisk/develop/codexteams`에 Pi 확장 프로젝트 구현을 시작한다.
- Pi의 로그인·TUI·세션 기능을 활용하는 순수 확장이다. 별도 daemon이나 Codex 실행기는 만들지 않는다.
- Terra·Sol·Astra와 작업별 추론 단계를 명시적으로 배정하고 사용량을 기록한다.
- 임의의 기본 시간·턴·금액 한도를 두지 않는다.

## Mac 접근이 제공되는 세션에서 할 일

1. 실제 사용자 홈과 `develop` 경로를 확인한다. 원문의 `eyedisk/develop/codexteams`를 임의로 다른 사용자의 폴더로 해석하지 않는다.
2. 대상이 비어 있거나 없으면 패키지를 그 위치에 복사한다. 기존 내용이 있으면 조사한 뒤 병합하며 덮어쓰거나 삭제하지 않는다.
3. Node >=22.19.0와 Pi 1.4.x를 확인한다. 패키지 버전이 다르면 타입·CLI 호환성을 확인한다.
4. 소스의 README를 읽고 `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm run smoke:load`를 실행한다.
5. `pi install <확인된 절대 경로>`로 로컬 패키지를 등록한다. 기존 인증을 재사용하고 키나 토큰을 이 대화나 로그에 출력하지 않는다.
6. Pi를 다시 열거나 `/reload` 후 `/teams help`와 `/teams status`를 확인한다.
7. 사용자가 지정한 앱 프로젝트에서 실제 모델 실행을 검증한다. 이는 실제 계정 사용량을 소비하므로 이미 승인된 프로젝트 범위에서 작은 목표로 확인한다. 사용 가능한 모델과 지원 effort를 먼저 확인한다.

## 구현과 문서의 경계

- 현재 0.1은 순차 쓰기다. 격리 worktree를 통한 병렬 쓰기와 자동 통합은 이후 단계다.
- 실행 결과는 `needs_review`다. 사용자 직접 `accept`를 자동 테스트 성공으로 바꾸어 표시하지 않는다.
- `check`는 사용자가 입력한 shell 명령을 실행한다. 일반 작업과 동시 실행되지 않는다.
- 강제 종료 복구에서 살아 있는 PID/그룹을 무조건 죽이지 않는다. PID 재사용 가능성을 고려한다.
- Linux fixture subprocess 테스트와 실제 Pi 로더 검증은 수행했지만, Mac에서의 실제 TUI·로그인 모델 호출은 아직 검증하지 않았다.
- 구현 상세: `docs/design/2026-11-01-pi-extension.md`; 검증 내역: `docs/verification.md`.

## 앞으로 이어갈 우선 작업

Mac에서 첫 실제 실행 → 그 결과의 사용량/취소/재개 확인 → 실제 앱 개발을 통한 역할 배정 개선 → 격리된 병렬 작업과 자동 검증.
