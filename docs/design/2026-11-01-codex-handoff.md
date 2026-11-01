# Codex → Teams → Codex 작업 인계

사용자는 Codex에서 작업 맥락을 Teams에 넘기고 실행 결과를 받아 검토하는 첫 흐름의 설계와 구현을 요청했다. 이후 실제 Terminal에서 안정 버전 Teams로 Teams 자체를 개선하며 Astra·Sol·Terra의 역할별 사용을 검증하도록 범위를 구체화했다. 구현은 GPT 6.1 Terra만 사용한다. GPT 6 Astra는 계획, GPT 6.1 Sol은 독립 검토를 담당한다. 추론은 high로 요청한다. 현재 Codex 세션 설정은 변경하지 않는다. 실제 provider 실행과 서비스 모드는 반환 근거 범위에서만 보고한다.

## 선택한 접근

기존 TypeScript CLI와 순수 Pi 확장을 연결한다. 버전이 있는 JSON 파일을 인계 입력으로 받고, JSON 결과를 반환한다. 별도 daemon·계정 서버·Codex 실행기는 만들지 않는다. MCP 서버는 후속 선택지다. 현재 CLI와 컨트롤러가 이미 제공하는 순차 실행·소유자 잠금·복구·검토 대기를 재사용하므로 가장 작은 실행 경로다. Codex의 네이티브 대화·인증·권한을 Pi로 이전하지 않는다.

## 외부 명령

`codexteams --handoff /absolute/request.json`은 요청을 검증하고 새 작업 하나만 실행한 뒤 단일 JSON 결과를 stdout으로 반환한다. 진단은 stderr로 보낸다. `--pi`와 기존 선택 우선순위를 지원한다. stdin의 비어 있지 않은 텍스트는 기존처럼 거부한다. 명령·프로필·파일 내용은 shell로 보간하지 않는다.

`codexteams --handoff-result REQUEST_ID`는 현재 프로젝트의 기존 상태만 읽어 같은 형식의 최신 결과를 반환한다. Pi 실행·모델 호출·상태 생성·잠금 획득·복구·수락을 하지 않는다. 상태가 없거나 요청이 없으면 구조화된 not_found를 반환한다. 기존 목표 인자·도움말·버전·TTY 동작은 유지한다.

Pi 내부에는 `/teams handoff <JSON으로 인코딩한 절대 파일 경로>`와 `/teams handoff-result <id>`를 추가한다. 입력 파일은 파싱·크기·루트 검증 후에만 쓰기 저장소를 연다. 실행은 기존 Pi 프로젝트 신뢰 검사를 통과해야 한다. TUI에서는 취소에 응답할 수 있도록 백그라운드 Promise로 실행하고 완료 결과를 표시한다. 비대화형 실행은 작업 종료를 기다린다. CLI는 JSONL의 전용 custom message에서 결과를 추출한다. Pi 종료 코드 0만으로 성공을 판단하지 않는다. 결과 누락·중복·잘못된 형식·요청 ID 불일치는 실패다.

`--handoff` CLI는 터미널 여부와 관계없이 Pi의 비대화형 JSONL 모드를 강제한다. 사람이 보는 TUI는 Pi 내부 `/teams handoff`로 제공한다. 설치된 node_modules 내부 TypeScript를 Node의 기본 loader로 직접 import하지 않는다. 단독 CLI의 요청/결과 읽기에는 패키지에 포함된 의존성 없는 .mjs 경로 또는 실제 배포되는 .js를 사용한다. 필요한 공통 검증은 중복하지 않도록 공유한다. TypeScript 확장 코드는 기존 Pi loader를 사용한다.

입력 파일은 호출자가 관리하는 디렉터리에 둔다. 현재 Node의 경로 구성요소 확인은 atomic directory-relative open이나 악성 동일 사용자 프로세스에 대한 OS sandbox를 제공하지 않는다. 최종 파일의 nofollow·일반 파일·descriptor identity·bounded read 검사를 유지한다. CLI는 처음 읽은 정규화 요청의 digest를 Pi에 전달하고, Pi는 다시 읽은 내용이 다르면 저장소를 열거나 실행하기 전에 거부한다. 이 지원 범위를 넘는 보안 보장을 주장하지 않는다.

## 요청 계약

schemaVersion=1, requestId, projectRoot, source, goal, task, context를 사용한다. 알 수 없는 필드·정책 필드·잘못된 자료형은 거부한다. 전체 입력은 UTF-8 64KiB 이하의 일반 파일이어야 한다. 입력의 실제 경로·크기 확인과 읽기에서 symlink/FIFO 및 무제한 읽기를 방지한다.

- requestId: ASCII 영숫자로 시작하며 영숫자·밑줄·하이픈만 허용한다. 최대 64자다.
- projectRoot: 절대 경로다. realpath 기준으로 받는 Pi의 cwd와 같아야 한다.
- source: kind="codex", 선택적인 sessionId, checkpoint 문자열, stopped=true. stopped는 발신자의 선언이며 다른 프로세스의 정지를 증명하지 않는다.
- goal: 1..16384바이트 문자열.
- task: title(1..160자), description(1..16384바이트), role(developer/designer/reviewer), acceptance(1..16개 관찰 가능한 조건). 역할별 저장 프로필을 사용한다. 요청에 모델·인증·자동 수락·실행할 검증 명령을 넣지 않는다.
- context: summary 문자열, completed·constraints·files·evidence 문자열 배열. 배열 수와 개별 문자열을 제한한다. 파일·근거는 참조 자료다. 임의의 경로를 자동으로 읽어 출력하거나 shell로 실행하지 않는다.

정규화한 필드의 순서가 일정한 직렬화로 SHA-256을 계산한다. JSON 객체의 키 순서 차이는 같은 요청으로 본다. 원래 텍스트·배열 순서·루트·조건이 달라지면 다른 요청이다.

## 영속성과 중복 실행 방지

작업의 선택적 handoff 기록에 원본 요청, digest, 제출 시각, 실행 전후의 bounded workspace 관찰과 실행 오류를 보관한다. 기존 schemaVersion=1 상태는 계속 읽을 수 있다. 저장소 검증은 추가 기록과 요청 ID 유일성·digest·루트·작업 연결을 검사한다.

컨트롤러는 하나의 exclusive 작업 안에서 요청 ID+digest+새 task를 한 번의 locked state update로 예약한 후 해당 task ID만 실행한다. 기존 프로젝트의 목표·다른 작업·프로필·수락·검증 기록을 보존한다. 인계 작업의 목표와 맥락은 해당 worker prompt에 포함한다. planner를 다시 호출하지 않는다.

같은 ID·같은 digest는 queued/running/failed/interrupted/needs_review/completed 어느 상태에서도 기존 결과만 반환하고 실행하지 않는다. 같은 ID·다른 digest는 거부한다. 예약 후 시작 전 중단도 자동 재시도하지 않는다. 인계로 예약한 queued 작업은 일반 run/runQueue에서도 자동 실행하지 않도록 처리하며, 실행 의도가 불확실하면 실패/중단과 복구 안내를 남긴다. 재시도는 사용자가 기존 `/teams resume <id> [지시]`로 명시한다. 결과 조회는 현재 시도와 과거 시도를 구분한다.

구체적인 crash-gap 복구는 명시적인 ID 재개로 제공한다. `resume <id>`는 handoff 기록이 있는 queued 작업도 허용하되 일반 queued 작업의 기존 동작은 유지한다. 자동 run과 목록의 자동 선택은 이 예외를 적용하지 않는다. 예약만 된 결과에는 해당 ID의 명시적 resume 안내를 포함한다. 이는 자동 재전송의 실행 권한과 구분된다.

실행 전 모델 검증이 실패하면 예약된 요청과 오류를 남기고 자동 재시도하지 않는다. 저장소 소유권 상실·취소·종료·복구 차단은 기존 안전 규칙을 유지한다. 다른 Pi 소유자가 잠금을 보유한 경우 중복 제출이 실행을 우회하지 않는다. 읽기 전용 결과 조회는 계속 가능하다.

## 결과와 검토

결과에는 schemaVersion=1, kind="codexteams.handoff.result", requestId, digest, 프로젝트 ID·루트·revision, 작업 ID·상태, 실행 시도·프로필·effectiveModels·usage·결과 텍스트·오류, attempt에 연결된 실제 check 기록, recoveryRequired, 한계를 포함한다. 요청이 거부되거나 없으면 task는 없고 error/status가 원인을 설명한다. CLI 실패 종료 코드는 worker failed/interrupted·요청 거부·프로토콜 오류를 구분할 수 있을 정도로 문서화한다.

worker가 쓴 검증 설명은 worker 보고다. 컨트롤러의 checks는 실제 수행 기록이다. Git 관찰은 고정 argv의 read-only 명령으로 수집한 실행 전후 status와 제한된 diff 요약으로 표현하고 관찰 불가·초과를 사실대로 표시한다. 기존 변경이 있으므로 모든 diff를 해당 worker의 성과라고 주장하지 않는다. 비 Git 프로젝트도 지원한다. 읽기 전용 조회가 새로운 관찰·명령 실행을 하지 않도록 저장된 관찰을 반환한다.

정상 worker 종료는 needs_review다. Codex는 결과·실제 파일·diff·검증 근거를 검토한다. 이 명령은 accept를 호출하지 않는다. 사용자 수락은 기존 명령으로 남긴다. docs/codex-handoff.md에 인계 파일 생성, 제출, 결과 수신, 독립 검토, 수정 재개와 최종 사용자 수락의 절차·JSON 예를 기록한다. 전역 Codex 설정·인증·권한은 변경하지 않는다.

## 실제 터미널에서 모델 확인

`/teams status`, `/teams show`, 진행 위젯에는 현재/최근 계획 또는 작업의 역할과 요청 모델·추론을 표시한다. 수신한 effectiveModels는 별도로 표시하고, 아직 응답이 없으면 확인 대기로 표시한다. 부모 Pi footer의 모델을 child worker 모델로 오인하지 않도록 계획 모델도 빠뜨리지 않는다. 기존 형식을 크게 바꾸거나 별도 대시보드를 만들지 않는다. 해당 formatter 회귀를 추가하고, 실제 사용량·추정 비용과 청구액을 구분하는 기존 문구를 보존한다.

## 검증과 실제 자체 개선

기준 commit은 29405bc이며 분리된 작업 공간의 npm run check는 TypeScript와 138개 테스트가 통과했다. 안정 버전의 extension을 원본 checkout에서 고정해서 실행하고, worker는 분리된 작업 공간만 수정한다. 원본 checkout을 수정·업데이트하거나 실행 중 extension을 reload하지 않는다. Teams 내부에서 Astra 계획 → Terra 구현 → Sol 독립 검토 → 필요한 Terra 재개 → Sol 재검토를 실제 Terminal로 관찰한다. 상위 세션은 제어·설계·인수 검증을 담당하고 substantive product 구현을 대신 쓰지 않는다.

새 회귀는 요청 경계, 모든 상태의 중복, crash gap, 기존 unrelated queued 작업, 신뢰·다른 root·소유권 상실·복구, 취소·종료, host exit0 오류, absent state 조회, symlink/FIFO/큰 입력, 실제 패키징·Pi JSONL 통합을 포함한다. 기존 전체 회귀·타입 검사·실제 로더·패키지 확인을 유지한다. 원격 유료 모델 실행은 이번 실제 Teams 자체 개선 범위에서 허용됐지만 단위·통합 테스트는 local fixture를 사용한다. 요청/관찰/실제 반환 모델/사용량과 unknown을 구분한다. push·배포는 이번 요청에 포함하지 않는다.
