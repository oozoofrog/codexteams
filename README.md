# codexteams

Pi 안에서 프로젝트 목표를 작업으로 나누고, 역할별 모델을 실행하며, 결과·검증·사용량을 보관하는 순수 Pi 확장입니다.

**0.6.0:** `/teams mode on`으로 팀 모드를 켜면 Pi의 일반 텍스트를 팀에 접수합니다. 팀은 요청별 구현·선언된 검증·독립 검토를 진행합니다. `/teams mode status`에서 요청 상태를 확인합니다. 결과 수락은 별도의 사용자 행동입니다. 모드와 복구 조건은 [팀 모드 안내](docs/team-mode.md)를 참고하세요.

Codex 인계 요청은 `codexteams --handoff /absolute/request.json`으로 제출하고, `codexteams --handoff-result REQUEST_ID`로 저장된 결과를 조회합니다. 요청 형식, 실패 코드, 독립 검토 및 명시적 재개는 [Codex 인계 안내](docs/codex-handoff.md)를 참조하세요.

## 설치

Node **22.19.0 이상**, npm, Git, Pi **1.4.0 이상 2 미만**이 필요합니다. macOS와 Pi 1.4.0에서 검증했습니다. Windows의 쓰기 worker는 지원하지 않습니다.

### codexteams 명령 설치

Pi가 설치되어 있다면 아래 명령으로 실행 명령을 설치합니다. 별도 clone은 필요하지 않습니다.

```bash
npm install -g --ignore-scripts --omit=dev --legacy-peer-deps --no-audit --no-fund git+https://github.com/oozoofrog/codexteams.git
codexteams --version
codexteams --help
```

`--legacy-peer-deps`는 Pi가 제공하는 패키지를 별도 복사본으로 설치하지 않도록 합니다. Pi는 아래 선행 단계에서 별도로 준비합니다.

작업할 프로젝트 폴더에서 실행합니다.

```bash
codexteams
codexteams "폴더 용량 리포트 CLI를 만들어 줘"
```

터미널에서 목표 없이 실행하면 팀 기본 화면을 엽니다. Pi에서는 `/teams` 또는 `/teams home`으로 열 수 있습니다. 방향키와 Enter로 작업과 행동을 선택하고 Esc로 돌아갑니다. 결과 확인, 수정 요청, 재시도와 수락은 각각 명시적으로 선택합니다. 수락에는 확인이 필요합니다. 새 작업은 대기 상태로 추가되며 자동 실행되지 않습니다. 화면을 닫아도 실행 중인 worker와 검증은 계속됩니다. 비대화형 실행은 상태와 명시적 명령을 출력합니다.

새 목표를 인자로 주면 역할별 프로필을 사용해 계획을 생성하고 실행 가능한 작업을 시작합니다. 기본 화면에서 입력한 새 목표는 먼저 계획만 만듭니다. 결과는 검토 대기에서 멈춥니다. 기존 목표나 작업 이력이 있으면 자동으로 다시 계획하거나 재시도하지 않습니다.

터미널에서는 Pi TUI를 사용합니다. 표준 입력 또는 출력이 터미널이 아니면 JSONL을 출력합니다. 목표는 인자로 전달하며, 파이프로 들어오는 텍스트는 Pi 실행 전에 거부합니다.

이 명령이 여는 Pi 세션은 이 설치본의 codexteams 확장만 명시적으로 로드합니다. 다른 자동 발견 확장과 그 확장이 제공하는 custom provider는 이 세션에서 로드하지 않습니다. 개인 Pi 설정과 로그인 파일은 수정하지 않습니다. 다른 확장과 함께 사용하려면 아래의 확장 전용 설치 후 일반 Pi에서 `/teams launch <목표>`를 사용하세요.

### 링크를 받은 에이전트의 설치 순서

1. `node --version`, `npm --version`, `git --version`, `pi --version`으로 기존 환경을 확인합니다. 필수 도구가 없거나 버전이 맞지 않으면 현재 OS의 패키지 관리자로 준비한 뒤 다시 확인합니다.
2. Pi가 없으면 검증 버전을 설치합니다. 기존 Pi가 지원 범위 밖이면 기존 설치 방법으로 호환 버전을 준비합니다. 로그인과 기존 설정을 초기화하지 않습니다.

   ```bash
   npm install -g @earendil-works/pi-coding-agent@1.4.0
   pi --version
   ```

3. 위의 `npm install -g ...` 명령으로 codexteams를 설치하고 `codexteams --version`, `codexteams --help`를 확인합니다. 이전에 `pi install URL`만 실행했다면 실행 명령은 아직 설치되지 않은 상태입니다.
4. 새 빈 폴더에서 다음 명령을 실행합니다. 목표 없는 조회이므로 작업 상태 파일을 만들거나 모델을 호출하지 않습니다.

   ```bash
   codexteams </dev/null
   ```

   종료 코드가 0이고 JSONL에서 `type`이 `message_end`, `message.customType`이 `codexteams`인 안내 메시지가 나오면 Pi와 확장 연결을 확인한 것입니다. 오류가 나거나 메시지가 없으면 설치 완료로 보고하지 않습니다.

5. 설치 결과에는 Node·Pi·codexteams 버전, 사용한 Pi 실행 파일과 위 확인 결과를 남깁니다. 특정 Pi를 선택하려면 아래 옵션이나 `CODEXTEAMS_PI` 환경 변수를 사용합니다. 선택한 Pi를 사용할 수 없으면 다른 실행 파일로 전환하지 않습니다.

   ```bash
   codexteams --pi /absolute/path/to/pi "프로젝트 목표"
   ```

6. 실제 목표를 전달하면 모델 호출과 프로젝트 파일 변경을 시작합니다. 로그인이 필요하면 사용자가 Pi의 `/login`을 완료한 뒤 `/model`에서 모델을 확인합니다. 역할별 프로필은 `/teams profile`로 설정합니다. 설치 확인만 할 때는 목표를 전달하지 않습니다. API 키나 OAuth 토큰을 복사하거나 로그에 출력하지 않습니다.

설치·조회에는 모델 로그인이 필요하지 않습니다. 위 확인은 실제 계정 모델 실행이나 전체 작업의 자동 완료를 검증하는 절차가 아닙니다.

### 업데이트와 제거

실행 명령을 업데이트하려면 처음의 `npm install -g ...` 명령을 다시 실행합니다. 제거할 때는 다음 명령을 사용합니다.

```bash
npm uninstall -g codexteams
```

제거해도 작업 프로젝트의 `.codexteams` 상태를 삭제하지 않습니다. 기존 Pi 프로세스는 사용 중인 버전이므로 종료한 뒤 `codexteams`를 다시 실행합니다.

### 일반 Pi에 확장만 설치

codexteams 실행 명령이 필요 없고 기존 Pi에서 `/teams` 명령만 사용하려면 아래 방법을 사용합니다. 이 방법은 PATH에 `codexteams` 명령을 추가하지 않습니다.

```bash
pi install https://github.com/oozoofrog/codexteams
pi list
```

실행 중인 Pi에서는 `/reload`합니다. 현재 프로젝트에만 등록하려면 해당 폴더에서 `pi install --local https://github.com/oozoofrog/codexteams`를 실행합니다. 프로젝트 설치는 Pi에서 해당 프로젝트를 신뢰한 뒤 로드됩니다.

확장만 업데이트하거나 제거할 때는 다음 명령을 사용합니다. 프로젝트 설치는 해당 폴더에서 업데이트하고, 제거에는 `--local`을 붙입니다. `pi update`만 실행하면 Pi 자체를 업데이트합니다.

```bash
pi update https://github.com/oozoofrog/codexteams
pi remove https://github.com/oozoofrog/codexteams
```

### 소스를 수정하며 설치

```bash
git clone https://github.com/oozoofrog/codexteams.git codexteams
cd codexteams
npm ci --ignore-scripts --no-audit --no-fund
npm install -g --ignore-scripts --omit=dev --legacy-peer-deps "$PWD"
```

이미 clone한 소스라면 해당 폴더에서 마지막 두 명령만 실행합니다. 새로 clone할 경로에 `codexteams` 폴더가 이미 있으면 기존 내용을 보존하고 다른 빈 경로를 선택합니다.

Mac에서 소스를 다른 폴더로 복사하며 명령과 일반 Pi 확장을 함께 설치하려면 다음 스크립트를 사용합니다.

```bash
bash scripts/install-macos.sh --target "$HOME/develop/codexteams"
```

기존의 비어 있지 않은 대상 폴더는 덮어쓰지 않습니다. `--copy-only`는 소스만 복사하며 명령 등록이나 Pi 설정 변경을 하지 않습니다. Pi가 관리하는 Git 설치 폴더는 업데이트 때 다시 맞춰질 수 있으므로 그 폴더에서 개발하지 않습니다.

Pi 확장 설치는 [Pi 패키지 문서](https://pi.dev/docs/latest/packages), 관리 명령은 [Pi CLI 문서](https://pi.dev/docs/latest/cli)를 참고하세요. 검증 범위는 [검증 기록](docs/verification.md)에 있습니다.

## 첫 프로젝트

작업할 앱의 프로젝트 폴더에서 실행합니다. 처음 연결할 때는 목표 없이 `codexteams`로 Pi를 열고 프로젝트 신뢰 상태·로그인·역할별 프로필을 확인합니다. 설정 후 Pi 안에서 `/teams launch <목표>`를 사용하거나, Pi를 닫고 아래 명령으로 새 목표를 시작합니다.

`/model`에서 실제 provider/model 이름을 먼저 확인하세요. 기본 프로필의 `openai`가 사용자의 로그인 경로와 같다고 가정하지 않습니다. 모델이 없거나 해당 effort를 지원하지 않으면 실행을 중단하며, `/teams profile`로 계정에 표시되는 정확한 조합을 지정할 수 있습니다. 이 개발 과정에서는 사용자의 실제 모델 사용 권한을 확인하지 않았습니다.

```bash
codexteams "간단한 Mac 디스크 용량 관리 앱을 만들어 줘"
```

`codexteams "목표"`와 `/teams launch <목표>`는 새 프로젝트의 계획 생성과 준비된 작업 실행을 연결합니다. 계획만 확인하려면 `/teams start <목표>`를 사용하고, 이후 `/teams run`으로 실행합니다. planner는 부모 세션과 별도로 지정한 모델을 사용합니다.

계획 생성 중에는 `add`를 사용할 수 없습니다. 계획이 끝난 뒤 후속 작업을 추가하세요. 일반 작업이나 검증 명령 실행 중에는 후속 작업을 추가할 수 있습니다. 일괄 실행은 요청 시점의 작업만 대상으로 삼습니다. 실행 중 추가한 작업은 대기 상태로 남으며 다음 명시적 시작이 필요합니다. `launch`는 계획 저장 직후의 작업을 대상으로 삼습니다.

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

검토 결과 수정이 필요하거나 중단된 작업을 이어가려면 재개할 작업을 목록에서 선택합니다. ID를 기억할 필요가 없습니다.

```text
/teams resume
```

실패·중단·검토 대기 작업의 이름, 상태, 역할이 표시됩니다. ↑/↓로 선택하고 Enter로 재개합니다. Esc로 취소하면 재개하지 않습니다. 기존 인수 조건과 과거 시도·검증은 보존합니다.

ID와 수정 지시를 직접 지정하는 방식도 사용할 수 있습니다.

```text
/teams resume task-1 빈 폴더와 접근 거부 상태도 처리해 줘
```

비대화형 실행에서는 후보 목록과 ID 지정 방법을 출력하며 자동으로 작업을 선택하지 않습니다.

## 명령

| 명령 | 동작 |
|---|---|
| `/teams` 또는 `home` | TUI에서 팀 기본 화면 열기 |
| `status` | 작업 목록과 알려진 사용량 표시 |
| `launch <목표>` | 새 프로젝트 계획 생성 후 준비된 작업 실행. 기존 프로젝트는 상태 표시 |
| `start <목표>` | 읽기 전용 계획 생성 |
| `add <역할> <내용>` | 후속 작업 추가 |
| `run [id]` | 준비된 작업 순차 실행 |
| `show <id>` | 결과, 인수 조건, 검증 기록 |
| `sessions` | 현재 프로젝트와 연결된 팀의 세션 선택 |
| `open <id>` | 지정한 작업 조회 세션 열기 |
| `home` | 조회 세션에서 팀 화면으로 복귀 |
| `resume` | 재개 가능한 작업 목록에서 선택 |
| `resume <id> [수정 지시]` | ID와 수정 지시를 직접 지정해 재개 |
| `check <id> <명령>` | 직접 지정한 검증 명령 실행 |
| `accept <id>` | 사용자 검토 수락 |
| `profile <역할> <provider/model> <effort>` | 이후 실행의 모델·추론 설정 |
| `cancel` | 실행/검증 중단과 실제 종료 확인 |
| `recover` | 강제 종료 후 프로세스·파일 확인 |
| `help` | 명령 안내 |

모델에 노출되는 `codexteams_status` 도구는 조회 전용입니다. 팀 모드가 켜져 있으면 일반 텍스트 요청에 따라 계획, 실행, 검증, 독립 검토와 수정이 자동으로 진행될 수 있습니다. 결과 수락은 사용자의 명시적 행동이며, 복구 확인은 `/teams recover`로 수행합니다.

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

한 프로젝트에는 하나의 확장 소유자만 실행됩니다. Pi의 new·resume·fork 세션 전환은 실행 중인 작업과 검증을 유지합니다. Pi 종료 또는 reload는 자식 실행을 중단하고 종료를 확인합니다. 작업을 계속하려면 Pi를 열어 두어야 합니다. 세션 조회와 제한은 [팀 세션 안내](docs/team-sessions.md)를 참조하세요.

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
