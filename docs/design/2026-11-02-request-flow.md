# ID 없이 사용하는 요청 흐름 0.7.0

사용자 요구: “사용자가 일일이 ID를 작성하는것은 불편합니다 물론 이것을 에이전트가 관리하면 문제가 안되겠지만 작업 시작과 과정 결과에 대해 세부 동작을 모르는 유저도 쉽게 사용 가능해야합니다”

현재 0.6.0의 일반 입력 자동 실행은 보존한다. 새 범위는 사용자가 ID나 구현·검토·checkpoint를 몰라도 새 요청, 진행 확인, 결과, 수정, 중단, 재개와 명시적 수락을 끝내는 것이다. 제품 런타임은 Pi Teams 안에서 동작한다. Codex 대화의 조율에 의존하지 않는다.

## 결정과 대안

Root는 실제 Astra task-9의 읽기 전용 설계를 채택한다. 기존 controller/supervisor 위에 요청 중심의 화면과 공통 행동 경로를 추가한다. 선택 명령만 추가하는 대안은 기본 화면의 중복 작업·상태 혼란을 남긴다. 자연어가 수락을 자동 결정하는 대안은 사용자 동의와 모델 판단을 혼동한다. 따라서 요청 목록과 보이는 행동을 기본으로 하고 기존 ID 명령은 고급 경로로 보존한다. 이는 Root의 구현 선택이며 사용자 사용성 수락을 뜻하지 않는다.

0.6.0은 HEAD `8cd87f6`으로 보존했다. 실제 Astra는 `openai/gpt-6-astra` high로 반환됐고 파일을 쓰지 않았다. 0.6.0의 247개 회귀와 실제 runtime 근거는 기준이다. 관련 입력이 바뀌면 필요한 회귀를 갱신한다.

## 기본 화면과 사용자 동작

- `/teams`와 CLI 기본 진입은 요청을 중심으로 표시한다. `새 요청`은 항상 찾을 수 있다. 원래 요청의 짧은 내용과 현재 상태·필요한 다음 행동을 보여준다. 답변만 있는 요청과 작업을 만들지 못한 요청도 포함한다. 같은 문장은 접수 시각·표시 순서 등으로 구별하되 실제 선택은 내부 key에 연결한다.
- 요청에 속한 구현/검토 Task는 기본 목록에서 중복 표시하지 않는다. `수동 작업`에서 연결되지 않은 기존 작업과 기존 행동을 그대로 사용할 수 있다. 역할·ID·attempt·check·JSON·scope digest 등은 요청의 상세 기록에서 확인한다.
- `새 요청`은 자연어 입력과 동일한 supervisor ingestion을 사용한다. 기존 start/launch의 수동 계획만 만드는 경로로 보내지 않는다. OFF라면 새 요청이 일반 입력의 팀 접수도 켠다는 점을 알리고 명시적으로 확인한 뒤 시작한다. 빈 입력·취소·신뢰 상실·화면 교체에는 상태 생성·모델 호출이 없어야 한다.
- 화면에는 실제 상태에 따른 `요청 확인 중`, `대기 중`, `작업 중`, `검증 중`, `결과 검토 중`, `결과 확인 필요`, `중단 요청 중`, `중단됨`, `확인 필요`, `답변`, `수락 완료` 등을 표시한다. 접수나 worker 종료를 전체 완료로 표시하지 않는다. 관찰하지 않은 진행률·프로세스 생존·테스트 성공을 만들지 않는다.
- 결과 화면은 원래 요청/변경, 현재 상태, 실제 구현 결과 또는 답변, 실패/대기 이유, 실제 검증·독립 검토 요약, 다음 행동을 보여준다. 선언된 검증이 없으면 없다고 표시한다. 숨겨진 버튼·기술 설명을 읽어야만 진행되는 화면은 만들지 않는다.
- 요청 상태에 맞춰 `결과 보기`, `수정 요청`, `이어하기`, `검증과 검토 다시 실행`, `결과 수락`, `중단 요청`, `상세 기록`을 제공한다. 수락한 요청은 과거 결과로 보존하고 후속 수정은 새 요청으로 만든다. 수동 Task의 기존 동작을 요청 행동으로 잘못 보내지 않는다.
- UI 기본 흐름은 방향키 선택→Enter→대상 행동이다. editor/selector/confirmation의 Esc는 취소다. 결과의 PageUp/PageDown과 뒤로 복귀를 유지한다. 선택과 상태는 색에만 의존하지 않는다. 화면 닫기·세션 이동·조회는 실행을 중단하거나 모델을 호출하지 않는다.

## 공통 행동과 ID 없는 명령

Home과 ID 없는 명령은 같은 eligibility/dispatcher/guard를 사용한다. `/teams request`는 요청을 선택하고 다음 행동을 고르는 진입점이다. `/teams request stop|resume|accept|revise|recheck [id]`에서 ID가 없으면 적합한 요청의 이름을 선택한다. 후보가 하나여도 자동 실행하지 않는다. 없는 후보와 취소를 정확히 표시한다. `/teams resume`의 기존 picker가 managed Task를 선택한 뒤 거부하는 막힌 경로도 제거한다. 기존 명시적 ID 명령과 headless 문법은 보존한다. headless에서는 임의 후보를 추측하지 않는다.

기본 접수·완료 알림은 UUID와 내부 enum 대신 요청 내용·상태·다음 행동을 표시한다. 고급 상태/기록 조회에는 식별자를 유지할 수 있다. `mode status`를 비롯한 기본 상태 안내에서 raw enum만으로 사용자가 다음 행동을 추측하게 하지 않는다.

- 중단: supervisor가 요청의 후속 scheduling을 먼저 막고 연결된 coordinator/worker/check의 종료를 기다린다. 아직 살아 있거나 execution promise가 끝나지 않았으면 `중단 요청 중`이다. Home의 일반 controller.cancel만 호출해 다음 managed 단계가 재시작되는 경로를 만들지 않는다.
- 이어하기: 안전한 checkpoint를 제품이 선택한다. 해당 요청의 coordinator/execution이 모두 끝나기 전에는 새 실행을 만들지 않는다. OFF이면 사용자에게 모드 전환과 재개를 확인한다. ON/reload/recover 자체는 저장된 미완료 요청을 자동 재개하지 않는다.
- 수정: 실제 지시를 해당 요청의 revision/amendment에 보존한다. 실행 중이면 기존 after_current/interrupt_then_resume 계약을 지킨다. 결과 확인 대기에서는 기존 PASS를 무효화하고 동일 writer 작업/세션의 수정→검증→검토를 실행한다. 과거 근거를 삭제하거나 과거 요청을 덮어쓰지 않는다.
- 재검증: 현재 파일에 선언된 check와 독립 검토를 다시 실행한다. 시작부터 writer를 실행하지 않는다. 검토가 수정을 요구하면 이유와 `수정 요청` 행동을 표시하고 멈춘다. 검증 요청만으로 파일 쓰기를 재위임하지 않는다.
- 자연어 중간 조율은 기존 protocol/authority를 보존한다. 0.7에서 model acceptance action을 추가하지 않는다. 선택 기반 행동은 ID를 해석하려고 모델을 추가 호출하지 않는다.

## 수락과 영속 상태

`accepted` 요청 상태와 명시적 user receipt를 추가한다. receipt는 수락 시각, request revision, 구현/검토 Task와 attempt, review evidence, check IDs, artifact/scope digest에 연결한다. 타입과 공통 `state-validation.mjs`/선언/packaged JS reader를 함께 갱신한다.

수락 경로는 기존 owner/trust/recovery/idle/revision/current attempt/current PASS/check IDs/scope/current artifact digest 검사를 모두 유지하고 미반영 amendment도 거부한다. UI는 선택한 결과와 수락 효과를 보여주고 사용자가 확인해야 진행한다. 모든 수락 진입은 지원되는 TUI/RPC의 명시적 확인을 요구한다. 직접 명령의 문자열만으로 사용자 동의를 판단하지 않는다. 모델 출력·status tool·extension 재입력·render는 수락 권한이 아니다.

하나의 store update로 구현 Task의 기존 user acceptance 필드와 요청의 accepted/receipt를 함께 기록한다. persistence 실패·중복 제출·stale confirmation에 부분 수락이나 중복 receipt가 생기면 안 된다. reviewer Task를 사용자 수락으로 위조하지 않는다. 기본 요청 수/결과 확인 수에 내부 reviewer를 중복 계산하지 않는다.

기존 0.6.0에서 writer가 이미 user accepted이지만 요청은 awaiting인 상태는 `이전 수락 결과`로 읽기 전용 투영한다. Home 조회 중 상태를 바꾸거나 새 receipt를 만들지 않는다. 과거 수락을 인정하기 위해 현재 파일을 과거 digest와 비교하지 않는다. 이 요청을 다시 수락·재개·재검증 대상으로 보내지 않는다. 새 0.7 metadata를 쓴 뒤에는 0.6으로 되돌려 수정하지 않는다.

## stale 선택·수명주기

모든 await 뒤와 실제 mutation 직전에 canonical root, 프로젝트 ID, session/UI generation, trust, readonly, owner/nonce, recovery, mode generation, request ID/revision/status, 관련 구현/검토 attempt·check·evidence·operation을 재확인한다. rerender가 열린 confirmation의 fence를 새 값으로 교체해서는 안 된다. 관련 없는 사용량/진행 갱신만으로 정상 행동을 막는 전역 store revision 비교는 사용하지 않는다. 같은 제목·목록 순서 변경으로 다른 요청을 실행하지 않는다.

순차 writer, 기존 native session 이동/원본 worker 읽기 전용·내용 불변성, 다중 root의 종료 fence/정리, OFF 후 현재 실행 의미, 모델/effort 명시와 실제 반환 모델 기록을 보존한다. 실제 key/SDK/worker/runtime/사용자 수락 근거를 구분한다.

## 소유권·검증·전달

실제 Terra가 `src/**`, `bin/**`, `tests/**`, package/lock, README와 사용자 안내 문서의 유일한 작성자다. Root는 이 설계·계획·진행·검증·WORK_HANDOFF·외부 근거·프로젝트 실행 설정을 소유한다. 실제 Sol은 writer가 멈춘 현재 소스와 근거를 독립 검토한다. 루틴 결정은 Root로 보낸다. 각 high이며 Normal wire mapping은 미확인이다.

같은 Pi/Terminal 7016만 사용한다. 다른 canonical source로 snapshot을 바꾸는 시도는 registry source identity에 거부돼 복원했다. 실패 원문은 외부 `codexteams-request-flow-070/stable-switch-failure.json`에 있다. 지금은 같은 canonical path에 로드한 0.6 module graph를 유지하며, 모든 product 쓰기/검토가 끝나기 전에는 reload하지 않는다. guard/runtime transport 소스의 불필요한 변경도 하지 않는다. 전역 설치·인증 설정은 바꾸지 않는다.

완료 기준은 ID 없는 새 요청→진행→결과→수정 또는 재검증→명시적 수락, 중단→정리→재개, 실제 상태/목록/취소/stale guards/old metadata/packaged reader까지다. 자동 테스트뿐 아니라 실제 Pi SDK와 loopback native worker의 public command+TUI component 경로를 확인한다. 이는 simulated user keys이며 실제 사용자의 수락을 뜻하지 않는다. 같은 실제 Pi에서는 120×30의 새 요청·목록·결과·상태와 취소 경로를 확인한다. 실제 개발 결과를 자동 수락하지 않는다. 현재 브랜치의 후속 commit·push는 이전 사용자 요청 범위로 Root가 최종 검증 후 수행한다. main 병합은 하지 않는다.


## 독립 검토 1 후 보완한 계약

실제 Sol task-11의 첫 구현 검토는 FAIL이며 7개 보완 사항을 보고했다. 앞선 WAIT 응답은 구현 검토가 아니었다. 원문과 별도 Root finding은 외부 근거에 보존했다.

- Pi 1.4는 expanded command를 input hook보다 먼저 실행하며 공개 command context에 입력 출처가 없다. extension의 `sendUserMessage(..., {expandPromptTemplates:true})`도 수락 명령에 도달한다. 따라서 legacy `/teams accept`와 request accept 등 **모든** 수락 경로는 public `ctx.ui.confirm` 뒤에 immutable target/evidence/owner/trust guard를 다시 확인한다. TUI/RPC는 mode와 hasUI를 모두 확인한다. Print/JSON은 지원되는 확인이 없으므로 명시적으로 거부한다. RPC의 extension_ui_request/response 확인은 client consent 경계이며 사람이 봤음을 증명하지 않는다. --yes, 추정 source, private SDK 우회나 source:user 문자열로 이를 대체하지 않는다.
- public SDK `runtime.session.sendUserMessage(command,{expandPromptTemplates:true})`로 legacy/request 두 수락 명령을 주입하는 회귀를 만든다. pending/false confirm에는 state/receipt/model이 바뀌지 않고, 별도의 true confirm은 최신 근거와 함께 한 번만 수락한다. Print/JSON 거부와 RPC dialog-capable 의미를 검사한다.
- 요청 action/result/details는 stable request ID로 매 render마다 최신 읽기 전용 상태를 투영한다. Back/Esc/조회에는 mutation evidence fence를 적용하지 않는다. 선택·editor·confirmation의 mutation fence는 열린 뒤 rerender로 교체하지 않는다. 같은 component를 실행/검증/검토 완료까지 유지하는 행동 회귀로 이를 확인한다.
- request fence의 operation identity는 해당 요청과 관련된 경우만 포함한다. 다른 요청의 no-artifact 검증이 끝났다는 이유로 정상 확인을 막지 않는다. 관련 요청 revision/evidence/check/artifact 변경과 실제 controller-idle 수락 gate는 유지한다.
- 자연어 coordinator stop도 공통 request-scoped settlement를 사용한다. 실행 promise와 실제 process가 끝나기 전에는 stopping을 유지하고 resume을 허용하지 않는다. 기존 coordinator protocol·대상 권한·중복 차단을 유지하며 현재 coordinator 자기 promise를 기다리는 deadlock을 만들지 않는다.
- Home mode action은 getController 뒤에도 최초 context/owner/trust/readonly/recovery/mode generation을 확인하고 실제 mutation 직전에 다시 확인한다. await 후 기준 owner를 무조건 교체해 이전 소유권 비교를 없애지 않는다.
- OFF에서 표시하는 revise/recheck/resume은 필요한 모드 전환을 명시적으로 확인한 뒤 실행하거나, 다음 행동이 보이도록 정확히 비활성화한다. 기본 흐름에서 눌러도 항상 실패하는 버튼은 제공하지 않는다.
- 결과에는 적용/대기 중 변경 지시를 포함한다. 상세 기록에는 연결된 writer/reviewer Task·attempt 이력·checks·review evidence/scope/digest와 수락 receipt를 포함한다. 기본 화면은 여전히 이 내부 ID를 입력하도록 요구하지 않는다.
- README의 기본 화면이 계획만 만든다는 과거 설명, 사용자 안내의 ID 필수 재개 안내와 manual subview의 raw status enum도 현재 동작과 사용자 행동에 맞게 정리한다. 기본 경로는 `codexteams`→새 요청이고 기존 positional goal/manual 명령은 별도 고급 흐름으로 명확히 구분한다.


## 독립 재검토 2 후 확인한 공통 진입 계약

- 일반 input hook과 직접 `/teams mode` 명령도 controller acquisition의 await 뒤에 최초 context/session/root/trust/readonly/owner를 검증한다. Home 경로만 고쳐서는 충분하지 않다. 이미 위임된 실행은 계속하고 stale 새 동작만 차단한다. 새 요청/mode/ordinary input 등 같은 acquisition 경계를 공통화해 경로별 누락을 막는다.
- action panel은 진행 중부터 PASS까지 열린 상태에서 새로 표시된 행동을 실행할 수 있어야 한다. mutation fence는 사용자가 선택한 현재 표시 상태에 연결하고 이후 editor/confirmation 동안 고정한다. panel을 열 때의 이전 evidence fence를 새 행동에 적용하지 않는다.
- `/teams request`의 요청 picker/action selector/result/details도 조회·취소에는 context/identity 검사만 사용한다. 일반 진행 변화가 lookup/result/Esc를 막으면 안 된다. mutation 선택 뒤에만 해당 target evidence fence를 고정한다.
- 120×30에서 긴 한국어 요청이 같아도 leading display number/compact time 등 비-ID 구분자가 실제 보이도록 열 너비를 예산화한다. timestamp를 80자 제목 뒤에 붙여 truncation으로 지우지 않는다. 선택은 항상 backend ID에 연결한다.
- README 첫 프로젝트/후속 작업의 기본 절차는 `codexteams`→새 요청→요청 행동이다. positional goal, `/teams launch`, task show/check/accept/resume은 수동/고급 절로 옮긴다. 새 요청 자동 실행과 수동 작업 추가의 대기를 섞어 설명하지 않는다.

실제 Sol task-11 재검토 원문은 `sol-review3-fail.md`에 보존했다. 앞선 7개 수정은 확인됐으나 위 5개 source finding 때문에 a7 기술 PASS를 최종 제품 완료로 보지 않는다.
