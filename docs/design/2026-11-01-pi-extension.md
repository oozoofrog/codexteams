# codexteams — 순수 Pi 확장 상세 설계

상태: 상세 설계 및 검증된 첫 구현의 기준, 2026-11-01. 제품 버전 0.1.0. Pi 호환 기준 1.4.0. 이후 단계의 제안은 별도로 표시한다.

## 1. 목표와 현재 작업 위치

사용자는 Pi에서 프로젝트 목표를 입력하고, 역할별 에이전트가 실제 프로젝트 파일을 수정하는 과정과 사용량을 확인한다. 프로젝트 진행 중 디자인 개선·기능 추가 같은 요청을 별도 작업으로 추가한다. 특정 부모 세션의 모델이나 대화 이력이 프로젝트의 유일한 상태 저장소가 되지 않는다.

원본 전달본은 Linux에서 구현·검증했다. 2026-11-01에 사용자의 Mac `/Volumes/eyedisk/develop/oozoofrog/codexteams`에 소스를 풀고 Git 저장소를 만들었다. macOS 후속 검증 범위는 `docs/verification.md`에 기록한다. 임시 Pi 설정에서의 설치 검증은 실제 사용 중인 Pi의 등록·reload나 계정 검증을 뜻하지 않는다.

사용자는 상세 설계 작성과 구현 시작을 함께 승인했다. 별도 설계 승인 대기 없이 이 설계의 첫 구현 범위를 진행한다.

## 2. 선택한 접근

| 접근 | 장점 | 비용·제약 | 결정 |
|---|---|---|---|
| Pi 확장 단독 | 로그인·TUI·세션·배포 재사용, 팀 정책부터 검증 | Pi 종료와 실행 수명 연결 | **0.1 채택** |
| Pi 확장 + 데몬 | 종료 후 작업 지속, 다중 클라이언트 | IPC·복구·서비스 운영 추가 | 필요가 생길 때 검토 |
| 독립 TUI + SDK | 완전한 제품 화면·브랜딩 | UI·인증·배포를 추가 구현 | 현재 구현 대상 아님 |

컨트롤러는 확장 내부 모듈이다. 별도 HTTP 서버, 상주 daemon, 계정 서버, Codex 실행기는 필요하지 않다. 에이전트마다 Pi 자식 프로세스를 실행하는 것은 이 확장 패키지의 내부 실행 방식이다.

## 3. 제품 원칙

- 사용자는 목표를 자연어로 전달한다. 모델 설정은 필요한 경우에만 바꾼다.
- 담당 역할은 필요할 때 실행한다. 상시 감독 모델을 두지 않는다.
- 상태 갱신·작업 큐·사용량 합산은 일반 코드로 처리한다.
- 모델·추론 단계는 작업에 명시하며 부모의 활성 설정을 무조건 상속하지 않는다.
- 공급자가 허용하지 않은 모델·effort를 조용히 다른 값으로 바꾸지 않는다.
- 임의의 시간·턴·달러 한도를 기본값으로 두지 않는다. 명시된 제한과 실제 실행 실패는 별도로 다룬다.
- 에이전트의 정상 종료는 작업 완료의 충분조건이 아니다.
- 모든 화면은 저장된 실제 상태를 표시한다. 추정 퍼센트·허구의 비용·원시 비공개 추론을 표시하지 않는다.
- 사용자의 프로젝트 파일·기존 Pi 인증·설정을 임의로 초기화하거나 덮어쓰지 않는다.

## 4. 0.1 구현 범위와 이후 범위

### 0.1에서 실제 제공

1. `/teams` 명령과 상태 조회 도구.
2. `/teams start <목표>`: 명시된 planner로 읽기 전용 계획 생성, JSON 구조와 의존성 검증, 저장.
3. 계획에 따라 개발·디자인 작업을 순차 실행하는 `/teams run` 및 단일 작업 실행.
4. `/teams add <역할> <작업>`: 실행 중인 프로젝트에 후속 작업 추가.
5. 역할별 provider/model/effort 설정과 실행 전 capability 확인.
6. durable 프로젝트 상태, 작업별 시도·로그·worker session ID·사용량 저장.
7. 실제 child 종료를 확인하는 취소·shutdown 처리, 다음 시작에서 interrupted 판정.
8. 사용자 명령으로 실행하는 검증 명령과 검증 기록, 명시적 작업 수락.
9. 실제 Pi 패키지 타입 검사, 모델 호출 없는 fixture subprocess 통합 테스트.

0.1은 한 프로젝트의 쓰기 작업을 한 번에 하나만 실행한다. `start`는 계획을 생성하며 `run`이 코드를 바꾸는 작업을 시작한다. 완료된 실행은 `needs_review`가 된다. 사용자의 `accept` 또는 향후 등록된 신뢰 가능한 검증 정책이 `completed`로 전환한다. 처음부터 자동 판정기가 모든 요구사항 충족을 증명한다고 주장하지 않는다.

계획 생성 중에는 `add`를 거부해 계획 게시와 새 작업 ID 배정의 충돌을 막는다. 일반 worker나 검증 실행 중에는 후속 작업 추가를 허용한다.

### 다음 단계

- 작업별 격리 worktree와 검증된 통합을 전제로 한 병렬 쓰기.
- 명시된 인수 조건과 승인된 검증 명령에 따른 자동 완료 판정.
- 모델 배정 성능 측정과 근거 기반 승격·재시도 정책.
- 원클릭 task action이 있는 완전한 커스텀 보드.
- 장기 목표의 반복 계획·추가 지시 병합·전체 목표 종료 조건.
- 필요 시 daemon 또는 다른 클라이언트 연결.

## 5. 사용자 흐름

### 첫 프로젝트

Pi에서 로그인한 후 앱 프로젝트 폴더를 연다. 확장을 설치한 상태에서 `/teams start 간단한 Mac 디스크 용량 관리 앱을 만들어 줘`를 실행한다. planner는 프로젝트 파일을 읽고 계획 JSON을 생성한다. 검증된 계획은 작업 목록으로 저장되고 화면에 표시된다. `/teams run`은 준비된 작업을 의존 순서로 실행한다.

작업 결과는 검토 대기 상태로 표시한다. `/teams check <id> <명령>`은 사용자가 직접 지정한 검증 명령을 실제 프로젝트에서 실행하고 결과를 저장한다. `/teams accept <id>`는 그 작업에 대한 사용자의 수락을 기록한다. 의존 작업은 선행 작업 수락 후 실행 가능해진다.

### 후속 작업

`/teams add designer 디스크 사용량 화면을 더 읽기 쉽고 차분하게 개선해 줘`와 `/teams add developer Mac 폴더 접근 권한 요청과 거부 상태 UI를 추가해 줘`로 별도 작업을 추가한다. 새 작업은 같은 프로젝트의 기존 목표와 검증된 상태를 이어받는다. 같은 파일에 대한 쓰기는 순차 처리한다.

### 중단과 재개

`/teams cancel`은 실행 중인 자식에 취소를 전달한다. `cancel_requested`와 실제 종료 확인을 구분한다. Pi의 종료·reload·새 세션·resume·fork에서는 실행을 중단하고 정리한다. 훅이 실행되지 않은 강제 종료의 경우 다음 소유자가 기존 `running` 작업을 `interrupted`로 전환한다. `/teams resume <id>`는 새 attempt를 만들며 현재 파일과 이전 결과를 확인하도록 지시한다. 마지막 shell 명령을 자동 반복하지 않는다.

## 6. 모듈과 의존 방향

| 모듈 | 책임 | 외부 의존 |
|---|---|---|
| `src/index.ts` | Pi 이벤트·명령·조회 도구·수명 연결 | Pi API, TypeBox |
| `src/core/types.ts` | 프로젝트·작업·시도·사용량 계약 | 없음 |
| `src/core/store.ts` | 단일 소유자 잠금, 원자적 상태 저장, 복구 | Node fs/process |
| `src/core/planning.ts` | planner 출력 추출·검증·DAG 확인 | 없음 |
| `src/core/profiles.ts` | 역할별 기본값과 프로필 검증 | 없음 |
| `src/core/controller.ts` | 상태 전이·배정·순차 실행·중단·검증·수락 | store, runner |
| `src/runtime/pi-runner.ts` | Pi 자식 실행, JSONL 해석, 종료/오류/사용량 | Node child_process |
| `src/runtime/worker-guard.ts`, `worker-bash.ts` | worker 전용 Bash의 프로세스 그룹 소유권 유지 | Pi BashToolDefinition, Node child_process |
| `src/ui/format.ts` | 보드·결과·사용량 표시 문자열 | core types |

코어는 `ctx.ui`나 Pi extension context를 import하지 않는다. SDK·CLI 교체 시 runner 경계만 바꾼다. 화면과 slash command는 독립 앱으로 옮길 때 다시 연결할 부분이다.

## 7. 상태 모델

프로젝트는 canonical realpath와 고유 ID를 가진다. 현재 목표, 역할별 프로필, 작업, 계획 시도, revision을 저장한다. 작업은 id/title/description/role/dependsOn/acceptance/status와 attempts/checks를 가진다.

상태 전이:

| 현재 | 사건 | 다음 |
|---|---|---|
| queued | 선행 작업 completed + 실행 시작 | running |
| running | 정상 모델 응답과 실제 프로세스 종료 확인 | needs_review |
| running | API 오류·실행 오류·파싱 실패 | failed |
| running | 취소 완료 또는 세션 종료 | interrupted |
| needs_review | 신뢰된 사용자 수락 | completed |
| failed/interrupted/needs_review | 명시적 재개 | running (새 attempt) |

0.1의 `cancel`은 현재 실행 중인 attempt 또는 검증을 중단한다. 대기 작업 제거·취소 명령은 아직 제공하지 않는다. `cancelled`는 저장 계약에 예약된 상태다.

worker가 tool call로 자신의 작업을 수락할 수 없다. `completed` 전환은 slash command의 직접 사용자 입력 경로에서만 허용한다. 조회 도구에는 수락·권한 상승 기능을 넣지 않는다.

각 attempt는 requested profile, 실제 응답 모델, session ID, 시작/종료 시각, outcome, 마지막 출력, 사용량, 로그 경로를 저장한다. retry는 기존 attempt를 수정하지 않고 추가한다. 전체 목표 완료와 개별 작업 완료는 다른 개념이다.

## 8. 저장과 동시 실행

프로젝트 루트의 `.codexteams/` 아래에 `state.json`, `lock.json`, `sessions/`, `logs/`를 둔다. 저장소 디렉터리는 0700, 파일은 0600을 요청한다. 키·OAuth 토큰·환경 변수 전체를 저장하지 않는다. 이 디렉터리는 사용자가 공유하지 않는 운영 데이터다.

`state.json`은 임시 파일 쓰기·fsync·rename으로 교체한다. in-memory 상태는 저장 성공 후 공개한다. JSON schema/version과 canonical root를 검사하며 손상된 파일을 새 상태로 조용히 덮어쓰지 않는다. 예기치 않은 symlink를 따라 프로젝트 외부에 상태 파일을 쓰지 않도록 검사한다.

잠금은 동일 호스트의 PID와 소유자 nonce를 기록한다. 살아 있는 소유자가 있으면 새 실행을 거부한다. 다른 호스트 잠금은 자동 제거하지 않는다. 죽은 소유자의 잠금만 동일 내용 확인 후 복구한다. 동일 프로젝트의 여러 Pi 창에서 두 실행기가 동시에 쓰지 못하게 한다. 잠금은 OS sandbox가 아니며 임의의 다른 편집기의 파일 쓰기까지 막지 않는다.

## 9. 계획 생성과 신뢰 경계

planner는 `read,grep,find,ls`만 사용한다. planner의 JSON은 제안이며 실행 권한이나 프로필을 변경하지 못한다. JSON은 `{tasks:[{id,title,description,role,dependsOn,acceptance}]}` 형태다. role은 `developer|designer|reviewer`, id는 제한된 ASCII 식별자이며 중복·없는 의존성·자기 참조·cycle을 거부한다. 사용자 목표를 바꾸는 필드, budget/approval/tool/provider 설정은 허용하지 않는다.

계획은 최소 1개, 최대 32개 작업으로 제한한다. 이는 한 번의 계획 문서 크기·UI·검증을 위한 입력 크기 한도이며 실행 시간·토큰 예산 한도가 아니다. 목표 16 KiB, 계획 출력 256 KiB, 개별 텍스트 16 KiB로 입력 저장 크기를 제한한다. 한 번의 계획에 프로젝트 전체가 반드시 담긴다고 가정하지 않는다.

기존 작업이 있는 프로젝트에서 `start`가 계획을 덮어쓰지 않게 한다. 후속 변경은 `add`로 추가하고, 계획 재생성은 이후 별도 명령으로 제공한다.

## 10. 모델과 추론 정책

| 역할 | 초기 provider/model | effort | 의도 |
|---|---|---|---|
| planner | openai/gpt-6.1-sol | medium | 제한된 계획 제안 |
| developer | openai/gpt-6.1-sol | medium | 일반 구현 |
| designer | openai/gpt-6.1-terra | medium | 화면·디자인 작업 |
| reviewer | openai/gpt-6.1-sol | high | 검토 |

이는 프로젝트의 초기 정책이며 실측 최적 모델이라는 주장이 아니다. Astra는 사용자가 역할 프로필에 지정할 수 있다. `low|medium|high|xhigh|max`를 명시적으로 지원한다. `ultra`는 물리 API effort로 전달하지 않는다. 향후 깊은 검토 preset은 추론과 분업을 독립 설정으로 정의한다.

실행 직전에 Pi model registry에서 model, 인증 구성, 지원 thinking level을 확인한다. 지원되지 않으면 이유를 표시하고 호출하지 않는다. 실제 계정 entitlement는 공급자의 실행 응답으로 최종 판정되므로 catalog 확인만으로 성공을 약속하지 않는다. 다른 모델·API 과금 경로로 자동 전환하지 않는다.

`/teams profile <role> <provider/model> <effort>`는 이후 attempt에만 적용된다. 실행 중 attempt는 시작 시 설정을 유지한다.

### 10.1 첫 판단의 모델 의존성을 줄이는 방법

현재 부모 Pi 세션의 모델은 팀의 모델 결정권자가 아니다. 저장된 프로필, 사용자 원문 목표, 구조가 검증된 계획을 controller가 읽고 실행한다. planner가 응답에 모델 이름이나 비용 정책을 삽입해도 계획 검증에서 거부한다. 사용자는 계획을 본 뒤 실행을 시작한다.

다만 계획 자체의 품질은 여전히 선택한 planner에 영향을 받는다. 이를 없앴다고 주장하지 않는다. 후속 버전에서는 되돌리기 어려운 설계 결정을 별도 검토 작업으로 만들고, 근거·가정·대안을 기록해 다른 모델로 검토하거나 재계획할 수 있게 한다. 매번 여러 모델에게 같은 목표를 물어보는 방식은 기본값으로 삼지 않는다.

### 10.2 관찰 가능한 복잡도와 모델 배정 — 후속 구현 정책

사용자에게 작업을 먼저 '단순/복잡'으로 판정하라고 요구하지 않는다. 파일 조사와 실제 실행에서 아래 증거를 모으고, 배정 사유를 사용자에게 보여준다. 다음 표는 제품 정책의 출발점이며 모델 성능 벤치마크나 가격 순위가 아니다.

| 관찰된 작업 특성 | 초기 후보 | 승격을 검토할 증거 |
|---|---|---|
| 범위가 명확한 문구·스타일·국소 수정, 검증 경로가 분명함 | Sol low 또는 medium | 예상과 다른 의존성, 회귀, 요구 불명확성 발견 |
| 일반 기능 구현, 몇 모듈의 계약 조정 | Sol medium 또는 high | 재현 가능한 실패를 설명하지 못함, 설계 대안 충돌 |
| 화면 구조·정보 우선순위·디자인 시스템을 함께 조정 | Terra medium 또는 high | 시각 검토에서 반복되는 동일 결함, 여러 화면의 규칙 충돌 |
| 원인 불명 장애, 데이터 구조 전환, 권한·동시성처럼 실패 영향이 큰 설계 | Astra high/xhigh 또는 해당 계정에서 검증된 다른 프로필 | 재현·로그·최소 사례가 있어도 해결되지 않는 핵심 불확실성 |
| 한정된 고난도 판단이 구현 전체를 막고 있음 | 지원 모델의 max | 비용보다 해결 가치가 큰지, 다음 호출이 어떤 증거를 더 만들지 명시 |

판정 입력은 (1) 모르는 점과 상충하는 요구, (2) 영향을 받는 모듈·인터페이스, (3) 실패 시 복구 비용, (4) 검증 가능성, (5) 이미 시도한 방법과 실패 증거다. 파일 수나 코드 줄 수만으로 판정하지 않는다. 권한·결제·삭제 같은 영향이 큰 작업은 코드가 짧아도 별도 검토 대상이 될 수 있다.

모델 변경과 effort 변경은 독립 결정이다. 단순히 한 단계씩 모두 올리는 사다리를 고정하지 않는다. 재현 가능한 실패, 독립 검토의 구체적 지적, 목표 변경처럼 새로운 증거가 있을 때만 재배정을 제안한다. 인증·지원 capability 실패를 '더 어려운 작업'으로 잘못 분류하지 않는다.

0.1에는 이 자동 판정기와 자동 승격이 없다. 역할 프로필을 사용자가 명시적으로 변경할 수 있고 실행 당시 설정과 실제 결과를 저장하는 기반까지 구현했다.

### 10.3 Max와 Ultra의 구분

| 항목 | 의미 | 사용할 때 | 0.1 상태 |
|---|---|---|---|
| `max` | 선택한 모델이 지원하는 실제 추론 설정 | 충분한 자료가 있는 어려운 설계·원인 분석·최종 검토처럼 추가 추론 가치가 큰 작업 | capability 확인 후 전달 가능 |
| `ultra` 전략 | 조사·구현·독립 검토·불일치 해결을 조합하는 향후 제품 preset | 하나의 응답보다 독립적인 검증 경로가 필요한 중요한 변경 | 미구현; effort로 입력하면 명시적으로 거부 |

Ultra를 요청했다고 모든 worker를 Max로 올리지는 않는다. 예를 들어 Astra의 어려운 설계 판단, Sol의 범위가 분명한 구현, Terra의 시각 검토를 서로 다른 effort로 실행하는 전략을 표현할 수 있다. 구체적인 조합은 실제 계정 capability와 해당 프로젝트의 측정 결과로 정한다. 위 모델 이름만으로 우열이나 단가를 보장하지 않는다.

Ultra 전략을 추가할 때에는 `strategy`와 `effort`를 다른 필드로 저장하고, 실행할 단계와 종료 조건을 먼저 보여준다. 필수 검증이 통과하고 인수 조건이 충족되면 끝낸다. 새로운 증거 없이 같은 리뷰를 반복하거나 합의를 얻을 때까지 무제한 모델 호출을 하지 않는다. 불명확한 요구나 실패한 검증은 구체적인 차단 사유로 남긴다.

### 10.4 프로젝트에 따라 팀이 자라는 방식

역할 템플릿은 시작부터 존재하지만 모든 역할에 상시 모델 세션을 띄우지는 않는다. 계획 또는 사용자의 후속 요청에 필요한 작업만 만들고, 실행 시 해당 역할의 worker를 띄운다. 디자인 개선과 권한 기능 추가는 별도 task/attempt로 남아 모델·결과·검증을 구분할 수 있다.

후속 버전은 작업 유형, 배정 사유, 인수 결과, 재시도 원인, 알려진 총 사용량을 함께 집계한다. 성공한 첫 응답의 토큰만 비교하지 않고 계획·실패·재작업·검토까지 포함한 '수락된 변경 하나를 만드는 데 든 알려진 사용량'을 비교한다. 모르는 사용량은 계속 partial/unknown으로 남긴다. 표본이 적은 프로젝트에서 자동으로 최적 모델을 찾았다고 표시하지 않는다.

자동 정책을 도입해도 명시적 사용자 프로필이 우선한다. 정책 버전과 변경 사유를 저장하고, 모델 배정 변경이 기존 실행 이력이나 과거 수락 기록을 바꾸지 않도록 한다.

## 11. Pi worker 프로토콜

기준 Pi 1.4.0. `--mode json -p`, 명시된 provider/model/thinking, stable `--session-id`, 전용 `--session-dir`를 사용한다. `--no-extensions --no-skills --no-prompt-templates --no-mcp`로 재귀적인 팀 실행과 예상 밖 확장을 방지한다. 필요한 기본 도구는 역할별 `--tools`로 전달한다. spawn은 shell을 사용하지 않는다. CLI invocation을 shell 문자열로 합치지 않는다.

JSONL은 UTF-8 streaming decoder로 처리하고 LF에서만 분할한다. `message_update`의 text_delta와 tool event를 진행 상태로 표시하되 thinking 본문은 표시·저장하지 않는다. 최종 assistant `message_end`에서 사용량을 확정한다. usage delta와 `agent_end` aggregate를 다시 더하지 않는다. `reasoning`은 output의 부분집합이다.

정상 exit code만으로 성공 판정하지 않는다. signal, `agent_settled.aborted`, 최종 assistant stopReason/errorMessage, protocol 오류를 함께 확인한다. 최종 응답 누락이나 truncated JSONL을 성공으로 처리하지 않는다. stderr·진행·최종 텍스트는 메모리 크기를 제한해 저장한다.

취소는 process group에 SIGTERM을 보내고 짧은 정리 유예 후 SIGKILL을 시도한다. 실제 child `close` 전에는 완료로 기록하지 않는다. 정상 종료 후에도 살아 있는 descendant를 정리한다. 이 기능은 POSIX/macOS가 1차 대상이며 Windows 전체 프로세스 트리 종료는 별도 작업이다.

Pi 1.4 기본 Bash는 별도 detached group을 만들고 shell 종료 때 추적을 해제하므로 일반적인 백그라운드 명령이 worker보다 오래 살 수 있다. Bash를 허용한 worker에만 명시적인 private guard 확장을 로드하여 native BashToolDefinition의 실행 operations를 교체한다. shell은 worker의 그룹을 상속하고, worker 종료 시 해당 그룹을 정리한다. private owner record·부모 PID·OS의 PGID로 이 경계를 검증한다. planner/reviewer에는 guard를 로드하지 않아 Bash 권한을 추가하지 않는다. 의도적으로 다른 session/group으로 탈출하는 프로세스를 막는 OS sandbox는 아니다.

검증 shell도 `close`를 기다리기 전에 `exit`에서 그룹 정리를 시작한다. background child가 pipe를 붙잡았다는 이유로 작업 슬롯이 무기한 잠기지 않게 한다. 실행 중 확정된 assistant 사용량은 부분 합계로 저장하고, 최종 종료 때 완전성 상태를 확정한다.

## 12. 검증과 완료

개발 worker는 파일 수정과 실행을 할 수 있으나 자신의 완료 조건을 바꾸거나 수락하지 못한다. 최초 인수 조건은 작업 생성 시 controller에 저장한다.

`check`는 직접 사용자가 입력한 shell 명령만 실행한다. 출력·종료 코드·시각을 저장하고, 실패나 signal 종료는 통과로 표시하지 않는다. 명령은 사용자의 Pi 프로젝트 권한으로 실행된다. 성공한 명령은 그 명령에 대한 증거일 뿐 전체 요구 충족의 증명은 아니다.

검증 명령도 쓰기를 할 수 있으므로 worker와 같은 프로젝트 실행 잠금을 사용한다. 실행 중 worker/check와 겹치지 않으며 cancel·shutdown의 process-group 정리 대상이다. check에는 대상 `attemptId`를 저장한다. 수락 기록은 `acceptedAttemptId`와 당시 `acceptedCheckIds`를 연결한다. 검증 실행 중에는 수락할 수 없다.

검토 대기 결과를 수정할 때 `/teams resume <id> [수정 지시]`로 새 attempt를 만든다. 원래 인수 조건과 과거 검사 기록은 보존하되 새 attempt의 증거로 취급하지 않는다. 선행 작업이 검토 대기라 실행할 수 없으면 구체적인 대기 작업을 표시한다.

강제 종료는 정상 shutdown과 다르게 취급한다. worker PID를 생성 즉시 저장하고, 이전 실행이 `running`인 채 발견되면 `recoveryRequired`로 모든 신규 실행을 막는다. 알려진 PID/process group이 살아 있으면 자동 종료·재실행하지 않는다. PID 재사용이나 spawn-기록 사이 종료 때문에 신원을 증명할 수 없는 경우 직접 사용자가 프로세스와 파일 상태를 확인하고 `/teams recover`로 복구를 확인한다. 이 명령은 모델 호출 도구로 노출하지 않는다. 정상 종료 훅이 완료된 경우에는 이 추가 확인이 필요하지 않다.

`accept`는 직접 사용자 수락 기록과 당시 check 결과를 남긴다. 검증 명령이 없더라도 사용자의 시각 검토 같은 수락은 가능하며, 이 경우 자동 테스트 통과라고 표시하지 않는다.

## 13. 비용과 관측

requested/effective model, effort, input/output/cacheRead/cacheWrite/reasoning, 모델이 보고한 추정 비용을 구분한다. unknown은 0으로 대체하지 않는다. 공급자 청구서와 동일한 비용이라고 표시하지 않는다. ChatGPT 플랜 호출의 가격표 환산액을 실제 카드 청구액으로 표시하지 않는다.

계획·실패·중단 attempt도 집계한다. 하위 모델 사용량을 포함한 tool 결과와 부모 aggregate가 중복될 수 있으므로 0.1은 자체 child의 assistant message만 확정 합산하고 nested usage는 미포함임을 명시한다. 모델이 응답하기 전에 끊긴 호출의 사용량은 unknown이다.

진행 화면은 역할, model/effort, 실제 상태, 최근 도구명, 알려진 토큰을 보여준다. 비용 집계 상태는 complete/partial/unknown을 구분한다.

## 14. 권한과 보안의 실제 범위

Pi의 project trust를 존중하고 신뢰되지 않은 프로젝트에서 쓰기·worker 실행을 시작하지 않는다. 기존 인증은 Pi가 관리하며 codexteams는 인증 파일을 복사하거나 수정하지 않는다. native Pi tool 권한은 OS 계정 권한이며 cwd·tool allowlist는 OS sandbox가 아니다. 이 구현이 Codex의 sandbox를 재현한다고 설명하지 않는다.

worker의 확장 재귀를 끄고 controller state에 대한 수정은 금지한다고 지시한다. 모델의 파일 접근을 OS 차원에서 완전히 강제하려면 이후 별도 실행 격리가 필요하다. 0.1은 악성 worker에 대한 보안 경계가 아니라 정상적인 팀 실행을 위한 로컬 확장이다.

## 15. 설치와 배포

프로젝트는 TypeScript ESM이며 Node >=22.19.0, Pi >=1.4.0 <2를 기준으로 한다. 개발 의존성은 lockfile로 고정한다. `pi install <절대 프로젝트 경로>`로 설치하며 `/reload` 또는 Pi 재실행으로 반영한다. 공개 npm 배포나 GitHub push는 이번 범위에 포함하지 않는다.

Mac 설치 스크립트는 추출한 소스를 사용자가 지정한 대상 폴더에 복사한다. 대상이 이미 존재하고 비어 있지 않으면 덮어쓰지 않는다. 부모 디렉터리는 사용자의 명시적인 대상 경로 아래에서만 생성한다. Pi·Node 설치는 별도 기존 도구 여부를 먼저 검사한다. 설치 스크립트가 Mac에서 실행되었다는 증거가 없으면 설치 완료라고 보고하지 않는다.

## 16. 테스트와 출고 기준

- planner JSON 추출·거부·cycle·알 수 없는 role·작업 크기 한도.
- 단일 소유자 잠금, 죽은 소유자 복구, 손상 state 보존, atomic write, symlink 거부.
- 의존 작업 실행 제한, 동시 호출 중복 방지, 실패 후 attempt 보존, 검토 대기/사용자 수락 전이.
- 정상 JSONL·분할 UTF-8·Unicode line separator·exit 0 모델 오류·취소·descendant cleanup·truncated 출력.
- usage snapshot 중복 방지, reasoning/output 이중 계산 방지, partial/unknown 표시.
- 실제 Pi 1.4.0 타입 검사·extension load smoke. 유료 모델 호출 없이 fixture worker로 end-to-end 검증.
- native Pi BashToolDefinition을 사용한 일반 백그라운드 프로세스·취소·명시적 timeout 회귀 검증. PID/프로세스 그룹 정보가 가상화된 테스트 환경에서는 실제 OS 정보를 제공하는 승인된 실행 경로를 사용하고, 실패한 조회를 종료 증거로 간주하지 않는다.
- Mac 실제 폴더 설치·실제 로그인 모델 호출·터미널 시각 사용성은 해당 환경 접근 후 별도 검증하며 이번 결과와 구분한다.

## 17. 공식 근거

- https://pi.dev/docs/latest/extensions
- https://pi.dev/docs/latest/cli
- https://pi.dev/docs/latest/json
- https://pi.dev/docs/latest/message-types
- https://pi.dev/docs/latest/packages
- https://pi.dev/docs/latest/security
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json
- https://pi.dev/models/openai/gpt-6-1-terra
- https://pi.dev/models/openai/gpt-6-1-sol
- https://pi.dev/models/openai/gpt-6-astra

문서 조회와 registry 확인 기준일: 2026-11-01. 배포 시 Pi 버전을 고정하고 API 변경을 다시 확인한다.
