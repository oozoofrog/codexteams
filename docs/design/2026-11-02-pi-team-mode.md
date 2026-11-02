# Pi 자체 팀 모드 0.6.0 — 요구사항과 설계 검토

사용자 요구: “코덱스가 해주면 안됩니다. pi 의 teams 만으로 가능해야합니다. teams가 내부에서 코덱스를 사용하는것과 별개로 pi 에서 사용할때를 말하는거에요.”

이 기능의 런타임은 Pi와 Teams 확장만으로 동작해야 한다. Codex 대화, Codex CLI, 외부 조율 프로세스, 별도 daemon에 의존하지 않는다. 현재 Codex가 개발을 조율하는 것과 제품 런타임의 독립성은 구분한다.

## 반드시 동작해야 하는 사용자 흐름

1. 기존 팀을 유지한 채 Pi에서 팀 모드를 ON/OFF한다. 기본값은 OFF다. 현재 모드와 요청의 접수·진행·대기·실패를 화면과 상태 조회에서 확인한다. 프로젝트 설정을 저장하고 세션 전환·Pi 재시작에도 모드를 구분한다.
2. ON에서는 일반 입력으로 목표나 기능 추가를 요청한다. 작업 ID, 스킬 이름, 매 단계의 `/teams run` 호출을 요구하지 않는다. 팀 내부에서 계획·실행·검토·필요한 수정을 이어간다. 일반 질문·상태 문의를 무조건 구현 작업으로 만들지 않는다.
3. 작업 중 “이 기능도 추가해줘”, “이것부터 먼저 해줘”, “기존 방향을 바꿔줘”, “중단해줘”를 Pi에서 전달한다. 접수한 요청을 보존하고 실제 반영 상태를 표시한다. 현재 worker에 지시를 실시간 주입한 것처럼 표시하지 않는다. 실제 API로 가능한 대기·중단·새 지시 재개를 사용한다.
4. OFF에서는 일반 Pi 동작을 유지한다. 모드를 끄는 것과 실행 중인 작업을 중단하는 것은 구분해 표시한다. OFF 후 대기 작업이나 완료 알림이 새 모델 실행을 자동으로 일으키지 않게 한다. 기존 결과·기록은 보존한다.
5. 종료·reload·프로젝트 변경·복구·재접속에서 중복 실행이나 잠금 우회를 만들지 않는다. 저장된 ON만으로 미완료·복구 대기 작업을 조용히 재시도하지 않는다. 새 요청과 명시적 재개를 구분한다.

## 보존할 계약

- 0.5.0의 일반 작업·handoff·Home·조회 세션·검증·소유권·취소를 보존한다. 이전 210개 회귀와 현재 미커밋 결과를 유지한다.
- 쓰기 worker는 순차 실행한다. 모델은 설정한 실제 provider/model/effort를 사용한다. 역할을 바꾸거나 다른 모델로 조용히 대체하지 않는다. Astra 팀장/설계, GPT 6.1 Terra 구현, GPT 6.1 Sol 독립 검토라는 현재 프로젝트 설정을 유지한다. 사용자 인증·개인 기본 설정을 바꾸지 않는다.
- 사용자 수락은 자동 처리하지 않는다. 모델 성공이나 내부 검토를 `acceptanceSource:user`로 기록하지 않는다. 자동 조율이 다음 단계를 진행하는 근거와 최종 사용자 수락을 구분한다. 기존 `completed` 의미를 바꾸지 않는다.
- 기존 수동 Home/CLI의 작업 추가는 자동 실행되지 않는다. ON의 일반 요청으로 명시적으로 위임한 작업과 수동 대기 작업을 구분한다. 기존 legacy 작업을 전부 재실행하지 않는다.
- 새 목표가 기존 프로젝트 목표·작업 설명·이력을 덮어쓰지 않는다. 요청별 범위와 실행·검토·수정의 연결을 남긴다. 요청·완료 이벤트를 중복 처리하지 않는다.
- 조율·구현·검토의 실제 사용량과 반환 모델을 빠짐없이 기록한다. 존재하지 않는 진행률·검증·수락·배포를 만들지 않는다.

## 공개 Pi API에서 확인한 제약

- 일반 interactive/RPC 입력은 `input` 이벤트에서 처리할 수 있다. 명령은 기존 Pi 명령 경로를 유지한다. Teams가 소유한 요청의 저장·라우팅 오류는 handler 내부에서 잡아 안전하게 응답해야 한다. Pi는 handler 예외를 일반 모델 처리로 넘길 수 있다.
- extension-origin 입력을 일반 사용자 요청으로 다시 접수하지 않는다. 이미지와 streaming 의도를 보존하거나 지원하지 않는 경우 분명히 거부한다. 외부 worker가 busy여도 부모가 idle이면 RPC steer/follow_up의 구분이 input hook에 전달되지 않는다. 실제 child는 현재 print-mode·stdin ignored이므로 parent steering을 child steering으로 설명하지 않는다.
- Pi 부모 agent를 팀장으로 사용하는 대안과 별도 읽기 전용 조율 worker 대안이 가능하다. 가장 작은 완전한 구조를 선택한다. 단순한 키워드 분류나 프롬프트만으로 모든 라우팅·자동 검토가 보장된다고 주장하지 않는다.
- 부모 agent 대안을 선택하면 `pi.setModel`과 `setThinkingLevel`은 persist 없이 세션에 적용할 수 있다. 지원 effort를 먼저 검증하고 적용 후 실제 getter를 확인한다. OFF에서 원래 세션 모델·effort·도구 상태를 안전하게 복원한다. 사용자가 도중에 명시적으로 바꾼 설정을 무조건 덮어쓰지 않는다.
- `setActiveTools`만으로 권한 경계가 완성되지 않는다. deferred/codemode 도구를 포함한 실행 시점 gate가 필요하다. 팀장은 읽기·조율을 하고 파일 쓰기는 담당 worker가 수행하도록 한다.
- 완료 알림의 `triggerTurn:true`는 native 부모를 깨울 수 있다. `deliverAs:nextTurn`은 깨우지 않는다. 일반 input hook을 거치지 않는 custom 완료 turn도 모드·프로젝트·attempt·중복 여부를 검증한다. customType/details는 모델 컨텍스트 변환에서 사라지므로 서비스 이벤트임을 내용에도 표시한다.
- mode 저장은 프로젝트 store에 둔다. 세션 `appendEntry`만으로 프로젝트 모드 영속성을 구현하지 않는다. RPC는 custom TUI를 지원하지 않으므로 구조화한 메시지·조회 경로를 제공한다.

## 확정한 구현 구조

실제 Astra task-6의 최종 설계를 채택한다. 프로젝트별 process owner에 `TeamModeSupervisor` 하나를 둔다. supervisor와 기존 `TeamController`는 같은 `ProjectStore`와 잠금을 사용한다. 일반 Pi 세션은 입력·조회·표시를 담당하고, 별도의 읽기 전용 coordinator가 기존 `runPiWorker`를 통해 판단한다. coordinator는 `profiles.planner`, 구현은 해당 작업 역할, 독립 검토는 `profiles.reviewer`를 사용한다. 부모 모델·effort·도구 설정을 바꾸거나 부모 agent를 깨우는 구조는 사용하지 않는다.

- `team-mode.ts`는 접수·저장·실행·중복 억제·복구를, `team-mode-protocol.ts`는 JSON 계약·검증·프롬프트와 제한된 컨텍스트를 담당한다. coordinator는 직접 상태·파일·설정·shell을 변경하지 않는다. 정확한 요청·프로젝트·generation·대상 attempt에 연결된 제안만 낸다. 임의의 전역 store revision 변경으로 제안을 무조건 무효화하지 않는다.
- 프로젝트 상태에 자체 version이 있는 선택적 `teamMode`를 추가한다. 기존 상태는 OFF다. 요청 원문·출처·receipt·상태·amendment·작업 연결, coordinator attempt/사용량, 실행/완료 event와 독립 검토 근거를 저장한다. 모든 저장·참조 검증은 packaged `state-validation.mjs`에도 동일하게 적용한다. 기존 바이너리가 새 metadata를 무시한 채 안전하게 수정할 수 있다고 주장하지 않는다.
- 일반 입력 ON 경로는 기존 읽기 전용 조회 guard 다음에서 처리한다. interactive/RPC 출처와 실제 전달된 streaming 정보를 기록하고 저장 후 접수를 표시하며 `handled`를 반환한다. 내부 오류도 잡아 `handled`로 남긴다. extension 입력은 재접수하지 않는다. 0.6의 ON 입력은 text-only이며 첨부가 있으면 명시적으로 거부한다. OFF의 일반 Pi 첨부 동작은 유지한다.
- 질문·상태 문의는 coordinator의 답변으로 끝내고 개발 Task를 만들지 않는다. 작업 제안은 해당 사용자 요청에만 속한 새 workflow로 저장한다. 기존 목표·legacy 작업을 덮어쓰거나 모두 실행하지 않는다. 같은 문장의 반복도 새 사용자 요청일 수 있으므로 원문 해시만으로 버리지 않는다. event/receipt identity로 중복을 막는다.
- 현재 사용자 요청이 새 업무 범위다. 저장된 과거 프로젝트 목표·완료된 milestone·이전 모델 응답은 배경 자료로 표시한다. 과거 목표에 있던 “0.4.0만 반환” 같은 지시가 새 요청을 차단하거나 새 권한을 만들지 않게 프롬프트와 프로토콜에서 구분한다. 현재 Root가 task-7에 위임한 목표는 이 0.6.0 전체 구현이며, legacy 0.4.0 목표는 명시적으로 대체된 과거 작업 범위다. 기록 자체는 수정하지 않는다.
- 자동 흐름은 검증된 작업 계획 → 역할별 실행 → 선언된 검증 → 별도 reviewer 검토 → 필요한 동일 작업 수정·재검토 → 사용자 확인 대기다. 내부 단계의 readiness는 요청별 workflow 관계와 검토 근거로 판단한다. 기존 `Task.dependsOn`의 사용자 수락 의미와 `completed` 의미를 바꾸지 않는다. 새 managed 작업이 legacy `run()`으로 잘못 실행되지 않도록 명시적 경계를 둔다.
- 0.6의 자동 실행 단위는 사용자 요청별 하나의 구현 Task와 하나의 독립 검토 Task다. 세부 계획·여러 파일·여러 기능은 구현 Task의 description과 acceptance에 포함한다. 이는 작업량이나 검토 횟수 제한이 아니라 조율 단위다. mode coordinator의 `propose_plan`은 이 단위에 맞는 단일 writer task를 제안하고 supervisor가 reviewer task를 추가한다. 기존 수동 planner의 다중 Task/DAG 지원은 바꾸지 않는다. 별도 기능 추가는 별도 요청으로 보존한다. 이 구조로 요청 하나가 끝날 때까지 사용자에게 매 단계 run/accept를 요구하지 않으면서 기존 사용자 수락 의미를 보존한다.
- team-mode의 검증 명령을 지원할 때는 계획에 선언된 요청 범위의 명령만 같은 execution/check slot에서 실행하고 명령 출처를 team coordinator로 기록한다. 기존 수동 check의 사용자 입력 출처와 구분한다. 선언/실행하지 않은 검증을 통과로 표시하지 않는다. coordinator 자신에게 shell 도구를 주지 않는다.
- reviewer는 실제 별도 role/profile로 실행하고 엄격한 verdict를 반환한다. malformed·없음·blocked는 PASS가 아니다. PASS는 정확한 구현 attempt·check·artifact 근거에 연결한다. 수정이나 관련 artifact 변경은 이전 PASS를 무효화한다. artifact digest는 실제 내용을 확인한 범위여야 하며 stat/mtime/단순 diff 통계만으로 만들지 않는다. Git/비Git에서 범위·제한을 명시하고 근거를 얻지 못하면 검토를 막는다.
- 사용자 수락은 별도 명시적 경로다. 자동 조율은 사용자 수락 API를 호출하지 않는다. 요청 전체를 수락하는 UI를 제공한다면 대상 작업·attempt·검토/검증을 표시하고 실제 사용자의 확인 뒤에만 기록한다. 기존 0.5.0 수락 경로를 보존한다.
- 추가 요청은 writer 실행 중에도 저장·분류할 수 있다. 호환되는 추가 작업은 안전한 경계에서 진행한다. interrupt 변경은 기존 프로세스 종료를 확인한 뒤 같은 구현 작업을 새 지시로 재개한다. 우선순위·stop은 실제 요청 범위에 적용한다. 불분명한 대상은 Pi에서 질문하거나 blocked로 표시한다. 실시간 child 주입으로 표시하지 않는다.
- 한 coordinator와 한 execution/check만 허용한다. writer는 항상 하나다. 모드 ON에서는 부모 모델의 쓰기·bash·알 수 없는 도구 실행을 실행 시점에 차단한다. OFF여도 기존 Teams execution/check가 남아 있으면 부모의 쓰기가 겹치지 않도록 보호하고 이유를 표시한다. 이는 같은 프로젝트의 writer 중복을 막기 위한 모드 전환 계약이다.
- OFF는 먼저 저장하고 generation을 올린 뒤 coordinator를 취소한다. 현재 execution/check는 별도 중단 요청이 없으면 계속하지만 새 조율·검토·수정·worker는 시작하지 않는다. 늦은 결과는 보존하고 적용은 막는다. 다시 ON으로 켜도 기존 대기·중단 요청을 조용히 재시도하지 않는다. 명시적 재개 경로를 제공한다.
- 종료·reload는 먼저 scheduling을 막고 모든 owner의 coordinator/controller를 정리한다. 세션 전환은 supervisor와 실행을 유지하고 binding만 교체한다. coordinator만 실행 중인 경우도 active-owner 보호에 포함한다. 재시작의 ON은 모드 저장일 뿐 미완료 replay 허가가 아니다. cleanup 불확실성·같은 실패의 무의미한 반복은 pause/blocked로 보존하며 임의 review-count quota를 만들지 않는다.
- Home과 `/teams mode on|off|status`에서 모드를 제어한다. 필요 시 request resume/stop을 명시적으로 제공한다. 켜진 상태·팀장 조율·실행·접수/반영 대기·OFF지만 남은 실행을 구분한다. 실제 작업을 제출할 일반 입력창을 사용할 수 있게 모달을 닫는 경로를 유지한다. 자연어 ON/OFF를 지원하면 전체 문장이 명확한 제어 표현인 경우에 한정하고 질문/인용을 오인하지 않는다.
- standalone SDK/RPC 검증은 외부 Codex executable·앱 조율·모델 쓰기 도구 없이 일반 입력 하나에서 실행·검토·수정까지 끝나야 한다. 별도 interactive Pi를 만들지 않는다. 최신 writer/reviewer 결과가 끝난 뒤 같은 Pi에서 확인한다. 새 mode metadata를 실제 프로젝트에 쓴 뒤에는 기존 0.2.1로 해당 metadata를 수정하는 개발 운영을 하지 않는다.

실제 Astra가 이 요구사항과 공개 API를 읽고 구현 가능한 최소 설계를 제안한다. Root가 루틴 결정을 확정한다. 실제 Terra가 src/bin/tests/package/README 및 사용자 문서의 유일한 구현 작성자다. 실제 Sol은 현재 근거를 독립 검토한다. Root는 설계·계획·진행·검증·외부 근거·프로젝트 실행 설정을 소유한다. 팀 내부 결정은 Root로 전달하며 사용자에게 루틴 질문을 하지 않는다.

현재 작업 Pi 하나를 계속 사용한다. 테스트용 interactive Pi를 추가하지 않는다. 쓰는 동안 기존 전역 0.2.1을 프로젝트 설정으로 선택하며 전역 설치본은 수정하지 않는다. 기준 소스·상태·설정은 외부 `codexteams-team-mode-060` 폴더에 보존했다. 초기 범위에는 commit·push를 포함하지 않았다. 이후 사용자가 완료 후 commit·push를 명시적으로 요청했다. 최종 검증 후 Root가 현재 작업 브랜치를 commit·push한다. 전역 설치·인증 변경·자동 사용자 수락은 수행하지 않는다.

필수 검증은 OFF의 기존 동작, ON 일반 입력의 계획→실행→독립 검토→수정/완료, 진행 중 추가·변경·우선순위·중단, OFF의 후속 실행 차단, 세션/프로젝트 전환·재시작·복구·stale/소유권, 완료 알림 중복·재귀·오류 fallback, 첨부, 실제 요청/attempt/사용량, 모델·도구 복원이다. 공개 Pi SDK/RPC와 로컬 프로토콜 fixture에서 **외부 Codex 없이** 동작함을 증명한다. 같은 실제 Pi에서는 일반 텍스트 입력과 모드·상태 변화를 확인한다. 실패 근거와 검증 범위를 분리해 보존한다.

## 독립 검토 1에서 확정한 보완 계약

- 전역 종료·reload는 첫 `await` 전에 모든 owner의 binding을 떼고 supervisor의 새 scheduling을 동기적으로 차단한다. 그다음 각 owner를 정리한다. 앞선 owner의 종료가 지연되더라도 뒤 owner가 새 worker를 시작할 수 없어야 한다. 모든 정리 실패와 미확인 상태를 보존한다.
- 검토를 통과한 요청도 다른 요청의 변경 때문에 저장소 전체 digest가 바뀔 수 있다. 사용자는 요청별 명시적 재개로 현재 파일·선언된 검증·독립 검토를 다시 확인할 수 있어야 한다. 이 경로는 기존 PASS를 무효화하고 새 근거를 남긴다. 사용자 수락을 만들거나 불필요하게 구현을 다시 실행하지 않는다.
- reviewer의 실제 입력에는 원래 요청, 적용한 amendment의 ID·지시, 구현 Task의 description·acceptance, 선언한 check의 명령·결과가 있어야 한다. review identity와 저장 근거는 이 유효 범위와 요청 revision에 연결한다. 실제 입력에 없는 변경 요구를 reviewer가 안다고 가정하지 않는다. runtime fixture의 reviewer도 실제 입력에서 변경 요구를 읽어 판단해야 하며 미리 아는 expected marker만으로 PASS를 만들 수 없다.
- Home·widget은 ON/OFF, coordinator 조율, 구현·검증 실행을 구분한다. 조율과 실행이 동시에 진행되면 둘 다 표시한다. 질문만 처리한 프로젝트의 모델 호출과 사용량에도 coordinator attempt를 포함한다. 사용량의 unknown/partial 의미와 요청/반환 모델의 구분을 유지한다.

검토 2에서 앞선 수정은 확인됐지만 큰 reviewer payload가 사용자 수정 지시의 16 KiB 제한에 걸리는 경로가 발견됐다. reviewer payload는 별도 bounded transport로 전달한다. 선언된 check 수·출력과 유효 요구사항을 보존하고 truncation을 명시한다. 사용자 수정 지시의 상한은 유지한다. UTF-8 크기와 운영체제 argv 한도도 검증하며, ASCII 출력 4,000바이트의 성공한 check 4개가 실제 Pi의 독립 검토까지 도달하는 회귀를 추가한다.

검토 3에서는 stdin 전달만 통과해도 Pi의 전체 사용자 message_start/message_end echo가 기존 JSONL 상한을 넘을 수 있음을 확인했다. 수용하는 입력과 실제 Pi의 JSON 반환 경계를 함께 검증한다. 큰 사용자 echo와 assistant/tool output을 구분해 bounded 검사를 유지하고, 잘못된 JSON·UTF-8·중단된 record가 성공으로 바뀌지 않게 한다. 작은 digest receipt만 반환하는 fixture 외에 실제 Pi의 8 MiB 초과 사용자 echo와 정상 응답을 확인한다.
