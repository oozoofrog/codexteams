# codexteams

Pi 안에서 프로젝트 목표를 작업으로 나누고, 역할별 모델을 실행하며, 결과·검증·사용량을 보관하는 순수 Pi 확장입니다.

**0.1.0 첫 구현:** 별도 서버·독립 TUI·Codex 실행기 없이 Pi의 로그인과 화면을 사용합니다. 쓰기 작업은 순서대로 실행합니다. 모델의 정상 종료는 `검토 대기`이며 사용자가 수락해야 `수락 완료`가 됩니다.

## 설치

Node 22.19 이상, Pi 1.4.x가 필요합니다. Pi 자체 설치와 로그인은 기존 Pi 방식대로 진행하세요. 이 패키지는 API 키나 OAuth 토큰을 복사하지 않습니다.

소스 폴더 안에서:

```bash
npm ci --ignore-scripts --no-audit --no-fund
pi install "$PWD"
```

Pi에서 `/reload`하거나 다시 실행합니다. Mac의 목표 폴더로 옮기면서 설치하려면 추출한 소스 폴더에서 다음 스크립트를 사용합니다.

```bash
bash scripts/install-macos.sh --target "$HOME/develop/codexteams"
```

기본 대상도 `$HOME/develop/codexteams`입니다. 기존의 비어 있지 않은 폴더는 덮어쓰지 않습니다. `--copy-only`는 소스만 복사하고 의존성 설치나 Pi 설정 변경을 하지 않습니다. 이미 목표 폴더에 압축을 풀었다면 그 폴더에서 스크립트를 실행해도 됩니다.

macOS에서 확인한 설치·명령·자동 테스트 범위는 [검증 기록](docs/verification.md)에 정리했습니다. 격리된 Pi 설정의 설치 검증과 실제 사용 중인 Pi에 등록하는 단계는 구분합니다.

## 첫 프로젝트

작업할 앱의 프로젝트 폴더에서 Pi를 실행하고 Pi의 프로젝트 신뢰 상태와 로그인을 확인합니다.

`/model`에서 실제 provider/model 이름을 먼저 확인하세요. 기본 프로필의 `openai`가 사용자의 로그인 경로와 같다고 가정하지 않습니다. 모델이 없거나 해당 effort를 지원하지 않으면 실행을 중단하며, `/teams profile`로 계정에 표시되는 정확한 조합을 지정할 수 있습니다. 이 개발 과정에서는 사용자의 실제 모델 사용 권한을 확인하지 않았습니다.

```text
/teams start 간단한 Mac 디스크 용량 관리 앱을 만들어 줘
/teams status
/teams run
```

`start`는 파일을 읽어 계획을 생성하고, `run`은 준비된 작업을 실제로 수행합니다. 계획은 부모 세션과 별개로 지정된 planner 모델에서 생성합니다.

계획 생성 중에는 `add`를 사용할 수 없습니다. 계획이 끝난 뒤 후속 작업을 추가하세요. 일반 작업이나 검증 명령 실행 중에는 후속 작업을 추가할 수 있습니다.

결과를 확인하고 검증·수락합니다. `scan`은 예시 ID이며 실제 ID는 작업 목록에 표시됩니다.

```text
/teams show scan
/teams check scan swift test
/teams accept scan
/teams run
```

검증 명령은 직접 입력한 명령을 해당 프로젝트에서 실제 실행합니다. `swift test`는 Swift Package 프로젝트일 때의 예시이며, 프로젝트에 맞는 명령을 사용하세요. 검증 성공과 사용자 수락을 따로 기록합니다. 검사 없이 수락한 경우 자동 테스트가 통과했다고 표시하지 않습니다.

## 개선·후속 작업

```text
/teams add designer 디스크 사용량 화면을 차분하고 읽기 쉽게 개선해 줘
/teams add developer Mac 폴더 접근 권한 요청과 거부 상태 처리를 추가해 줘
/teams run
```

검토 결과 수정이 필요하면 기존 작업을 재개합니다. 인수 조건과 과거 시도·검증은 보존합니다.

```text
/teams resume task-1 빈 폴더와 접근 거부 상태도 처리해 줘
```

## 명령

| 명령 | 동작 |
|---|---|
| `/teams` 또는 `status` | 작업 목록과 알려진 사용량 |
| `start <목표>` | 읽기 전용 계획 생성 |
| `add <역할> <내용>` | 후속 작업 추가 |
| `run [id]` | 준비된 작업 순차 실행 |
| `show <id>` | 결과, 인수 조건, 검증 기록 |
| `resume <id> [수정 지시]` | 실패·중단·검토 대기 작업 재개 |
| `check <id> <명령>` | 직접 지정한 검증 명령 실행 |
| `accept <id>` | 사용자 검토 수락 |
| `profile <역할> <provider/model> <effort>` | 이후 실행의 모델·추론 설정 |
| `cancel` | 실행/검증 중단과 실제 종료 확인 |
| `recover` | 강제 종료 후 프로세스·파일 확인 |
| `help` | 명령 안내 |

모델에 노출되는 `codexteams_status` 도구는 조회 전용입니다. 실행·검증·수락·복구는 위의 사용자 명령에서만 이루어집니다.

## 모델 정책

| 역할 | 모델 | 추론 |
|---|---|---|
| planner | GPT-6.1 Sol | medium |
| developer | GPT-6.1 Sol | medium |
| designer | GPT-6.1 Terra | medium |
| reviewer | GPT-6.1 Sol | high |

초기 정책이며 성능 최적화가 실측으로 증명된 조합이라는 뜻은 아닙니다. 계정이 해당 모델을 사용할 수 있어야 합니다. 예를 들어 특정 검토에 Astra Max를 사용하려면:

```text
/teams profile reviewer openai/gpt-6-astra max
```

`low/medium/high/xhigh/max`를 지원하며 실제 모델이 지원하는 단계인지 호출 전에 검사합니다. 지원하지 않으면 조용히 낮추거나 다른 모델·과금 방식으로 바꾸지 않습니다. `ultra`는 물리 API effort로 전달하지 않습니다. 부모 Pi의 현재 모델을 바꿔도 팀의 저장된 프로필은 바뀌지 않습니다.

## 저장·복구

프로젝트의 `.codexteams/`에 작업 상태, worker 세션, 공개 진행 로그를 보관합니다. 이 운영 디렉터리를 프로젝트의 `.gitignore`에 추가하세요. 이 확장은 기존 `.gitignore`를 자동 수정하지 않습니다.

한 프로젝트에는 하나의 확장 소유자만 실행됩니다. Pi 종료·reload·세션 전환 시 자식 실행을 중단하고 종료를 확인합니다. 작업을 계속하려면 Pi를 열어 두어야 합니다.

강제 종료 후에는 이전 worker가 살아 있을 수 있습니다. 복구 확인 전까지 새로운 실행을 차단하고, `/teams recover`에서 남은 프로세스와 파일 상태를 확인합니다. 확인되지 않은 PID를 자동으로 죽이지 않습니다. 재개는 기존 부분 변경을 조사하며 이전 shell 명령을 무조건 반복하지 않습니다.

프로젝트 상태와 Pi 대화 분기는 별개입니다. `/tree`로 과거 대화를 열어도 실제 파일과 작업 완료 기록이 자동으로 되돌아가지 않습니다.

## 사용량의 의미

- 각 assistant 응답의 최종 사용량만 합산합니다. 스트리밍 snapshot과 `agent_end` 복사본은 중복 합산하지 않습니다.
- 추론 토큰은 출력 토큰에 포함되므로 다시 더하지 않습니다.
- 계획, 실패, 중단 시도도 기록합니다. 미확인 사용량은 0으로 표현하지 않습니다.
- 비용은 Pi가 보고한 추정치입니다. ChatGPT 플랜 차감이나 실제 카드 청구액과 같다고 볼 수 없습니다.
- 도구 내부에서 발생한 nested 모델 호출 사용량은 0.1 집계에 포함하지 않습니다.
- 상태 화면 갱신에는 모델 호출을 사용하지 않습니다. 임의의 실행 시간·턴·달러 한도를 기본값으로 두지 않습니다.

## 현재 범위

제공: 계획 검증, 역할별 실행, 의존 작업 대기, 명시적 모델/effort, 저장과 복구, 검증 기록, 조회 도구, 사용량 표시.

다음 단계: worktree를 통한 병렬 쓰기와 통합, 신뢰 가능한 자동 완료 판정, 반복 계획, 더 풍부한 작업 보드, 실측 모델 배정 개선.

Pi의 native tools는 실행한 OS 계정의 권한으로 동작합니다. 프로젝트 신뢰·cwd·도구 목록은 OS sandbox가 아닙니다. 이 확장은 Codex의 sandbox를 제공하지 않습니다. POSIX 프로세스 그룹 정리를 지원하지만 Windows 전체 프로세스 트리나 의도적으로 격리 경계를 벗어난 프로세스를 완전히 통제한다고 보장하지 않습니다.

쓰기 worker에는 private Bash guard를 적용해 일반적인 백그라운드 shell 명령도 worker의 프로세스 그룹에 남도록 합니다. 작업이 끝나면 이러한 프로세스를 정리합니다. 이 guard는 planner/reviewer에 Bash 권한을 추가하지 않습니다.

Bash 도구의 취소나 명시적으로 지정된 timeout은 해당 worker attempt 전체를 종료합니다. 기본 실행 timeout은 없습니다. POSIX 그룹 소유권을 확인할 수 없는 환경에서는 쓰기 worker의 Bash를 활성화하지 않습니다.

## 개발

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run smoke:load
npm run pack:check
```

자동 테스트는 유료 모델을 호출하지 않습니다. 실제 프로세스로 JSONL fixture를 교환하여 실행·오류·취소·사용량 처리와 controller 연결을 검증합니다. 실제 로그인 모델과 Mac TUI의 최종 사용성은 해당 환경에서 추가 검증해야 합니다.

- 상세 설계: [docs/design/2026-11-01-pi-extension.md](docs/design/2026-11-01-pi-extension.md)
- 구현 계획: [docs/plans/2026-11-01-pi-extension.md](docs/plans/2026-11-01-pi-extension.md)
- 검증 기록: [docs/verification.md](docs/verification.md)
- Mac의 ChatGPT Work에서 이어가기: [docs/WORK_HANDOFF.md](docs/WORK_HANDOFF.md)

공개 저장소: [oozoofrog/codexteams](https://github.com/oozoofrog/codexteams). npm 공개 배포는 수행하지 않았습니다.
