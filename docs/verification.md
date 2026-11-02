# codexteams 검증 기록

## 2026-11-03 0.7.0 배포·로컬 설치

- 현재 사용자 요청은 main 반영·원격 push·전역 Pi 확장 업데이트·CLI 설치를 포함한다. 제품 기준 `045585b`를 깨끗한 main에 fast-forward하고 원격에 반영했다. 추가 기능과 FiveBeat 개발은 수행하지 않았다.
- 독립 검토에서 a8 manifest의 109개 파일이 모두 현재 소스와 일치했다. 기존 277개 테스트·typecheck·loader·SDK/TUI·RPC·Node 22 근거를 재사용했다. 이번 배포에서 전체 테스트나 실제 모델 개발 흐름을 다시 실행하지 않았다. 포함 문서가 달라진 패키지는 dry-run을 새로 확인했다.
- 전역 Pi 확장과 CLI는 0.7.0이다. 설치 경로는 각각 `~/.pi/agent/git/github.com/oozoofrog/codexteams`와 `/opt/homebrew/lib/node_modules/codexteams`다. CLI의 PATH 진입점은 `/opt/homebrew/bin/codexteams`다. 설치 명령의 revision과 제품 파일 해시를 대조했다.
- CLI `--version`·`--help`와 빈 폴더의 목표 없는 실행은 exit 0이다. JSONL의 `message_end/customType=codexteams`를 확인했고 `.codexteams`를 생성하지 않았다.
- 일반 Pi RPC의 자동 탐색에서 전역 설치 경로의 `/teams` 한 개를 확인했다. 알려진 프로젝트의 로컬 리소스를 `--approve`로 해당 실행에서만 허용한 조회에서는 기존 로컬 소스의 `/teams` 한 개를 확인했다. 설정 파일은 변경하지 않았다.
- 실제 120×30 PTY의 일반 `pi --no-session --offline`에서 `/teams` Home·새 요청 editor·취소 후 Home 복귀·닫기·정상 종료를 확인했다. 모델 요청과 사용자 수락을 수행하지 않았고 빈 검증 폴더는 비어 있다. 이 PTY 실행은 기존 사용자 창의 reload나 사용자의 최종 수락을 증명하지 않는다.
- 기존 Pi PID 77936, 기존 설정·상태·인증 파일의 해시와 권한, FiveBeat 33개 파일의 해시를 유지했다. 전역·프로젝트 등록에서 관련 없는 설정을 변경하지 않았다. npm 공개 게시·강제 push·백업·자동 수락은 수행하지 않았다.
- 원문 로그·설치 revision·보존 검사·독립 검토는 외부 `codexteams-request-flow-070/delivery-070`에 있다. 최초 메타데이터 조회에서 존재하지 않는 전역 npm lockfile을 기대한 오류는 `initial-identity.json`에 남겼다. 설치 실패가 아니며 실제 설치 명령과 파일 해시로 신원을 확인했다. VoiceOver와 장시간 사용성 수락은 미검증이다.

## 0.7.0 ID 없는 요청 흐름 — 검증·현재 Pi 적용 완료

`/teams`의 **새 요청**에서 시작해 요청 이름으로 진행·결과·수정·재검증·중단·이어하기·수락을 선택한다. 수동 작업은 별도 화면에 유지한다. 수락에는 TUI/RPC 확인과 현재 구현·검증·독립 검토 근거가 필요하다. 확인 뒤 대상이나 근거가 바뀌면 거부한다. 요청과 writer의 수락 기록은 하나의 store update로 저장하며 과거 accepted-writer 조회는 상태를 이관하지 않는다.

실제 Astra task-9의 설계 뒤 실제 GPT 6.1 Terra task-10이 단독으로 제품을 작성했다. a8의 Node 26.12.1 전체 검사에서 typecheck와 **277개 테스트, 실패·취소·skip 0개**를 확인했다. 실제 loader와 package dry-run도 통과했다. 109개 제품·테스트·사용자 문서 파일을 외부 `codexteams-request-flow-070/product-freeze-a8-manifest.json`으로 고정했다. 실제 GPT 6.1 Sol task-11의 검토 4는 현재 소스와 회귀 근거를 PASS로 판정했다. 반환 모델은 각 `openai/gpt-6-astra`, `openai/gpt-6.1-terra`, `openai/gpt-6.1-sol`이며 high를 사용했다. 요청한 Normal의 native tier mapping은 확인하지 않았다.

고정 소스의 외부 검증은 `workcheck-runs-a8`의 다음 세 실행에서 PASS다.

| 실행 | 확인한 범위 |
|---|---|
| `ui-a8-01` | 실제 Pi SDK와 scripted TUI component의 표시·키 경로, 로컬 native write/check/독립 read, 검토 FAIL→수정→PASS, writer 없는 재검증, 명시적 수정과 최신 receipt 연결 |
| 같은 SDK 실행의 열린 화면 | 같은 결과 component의 검증 중→PASS 갱신과 뒤로 이동. 같은 행동 component에 새 수락 행동이 표시된 뒤 정확한 대상의 확인 창 도달. 취소 후 상태 전체 바이트·호출 수·파일 불변 |
| 같은 SDK 실행의 명령 재주입 | 공개 `sendUserMessage`로 두 수락 명령을 확장 origin에서 호출. 확인 대기와 false 응답 중 상태·파일·수락 기록 불변. 마지막 true는 격리된 synthetic fixture에만 적용 |
| `midwork-a8-01` | 실제 Pi RPC 일반 입력의 중간 변경, 이전 worker와 하위 프로세스 종료 뒤 동일 작업·세션 재개, 새 지시·check·검토 연결. 자동 사용자 수락 없음 |
| `node22-a8-01` | Node 22.19.0 격리 설치본의 accepted receipt 조회와 훼손 6종 거부. 고정 0.6 validator로 과거 형식 확인. Pi peer·실행 파일·TypeScript loader·모델 호출 없이 packaged JS 조회 |

SDK 검증은 화면 label 선택과 실제 component의 `render`/`handleInput`을 사용한다. 공급자는 제품 상태나 파일을 대신 작성하지 않는다. 각 재검증은 최신 reviewer attempt와 새 check ID를 사용하며 writer attempt와 파일을 유지했다. 프로세스·잠금·private prompt 디렉터리 정리, 환경 복원과 제품 해시 불변도 통과했다. Node 22 검증은 SDK 상태의 별도 복사본을 사용했고 원본 바이트를 유지했다. 이 SDK 수락은 시뮬레이션한 fixture 확인이며 물리 키나 실제 사용자의 수락 증명이 아니다. RPC/print 확인 동작의 회귀는 별도 SDK 모의 UI 검사이며 raw RPC wire 확인을 주장하지 않는다.

같은 Terminal/Pi 창 7016의 120×30 화면에 0.7.0을 reload했다. Home→새 요청→Esc는 기존 상태 바이트를 유지했다. 이어서 새 요청 editor에 읽기 전용 질문을 입력하고 모드 활성화를 확인했다. 실제 Astra high가 README를 읽고 `프로젝트 이름은 codexteams입니다.`라고 답했다. 조율 중과 답변 상태, 요청 선택→결과 보기→뒤로→Home을 관찰했다. 기존 개발 작업 11개·goal·profile과 사용자 수락 0개를 유지했다. 답변 뒤 읽기 전용 복귀도 상태 바이트를 바꾸지 않았다. OFF 전환과 reload 후 OFF·실행 없음의 기본 화면을 확인하고 그대로 두었다. 프로젝트 실행 설정 해시는 원본과 같다. `same-pi-result.png`, `same-pi-final-home.png`, `same-pi-final-summary.json`에 근거가 있다.

최종 셸의 `codexteams --version`은 `command not found`였다. 전역 CLI 사용 가능 여부와 개인 Pi의 설치된 확장을 구분한다. 실제 설치 경로의 package version은 0.2.1이며 전역 CLI를 설치하거나 교체하지 않았다. 현재 Pi의 0.7.0은 프로젝트의 로컬 소스 선택으로 적용됐다.

초기 미완료 결과, 실제 Sol 검토 2의 7개 결함과 검토 3의 추가 5개 결함은 모두 보존했다. 같은 Terra 작업에서 수정했고 최종 Sol 검토가 이를 확인했다. 첫 a5 외부 실행의 계약 scope와 임시 cache 분류 실패도 당시 FAIL로 보존했다. 이후 통과를 과거 실패에 소급하지 않는다. 전역 CLI 교체·인증 변경·개발 결과 자동 수락은 하지 않았다. VoiceOver, 장시간 실제 작업과 사용자의 최종 사용성 수락은 확인하지 않았다. 이번 Git 반영 범위는 `task/team-session-navigation`이며 main 병합은 포함하지 않는다.

## 0.6.0 Pi 자체 팀 모드 — 당시 검증·Pi 적용 완료

현재 실제 Terra task-7의 12번째 시도가 작성을 마쳤다. Node 26.12.1에서 typecheck와 전체 247개 테스트가 통과했다. 실패·취소·skip은 0개다. focused 56개, loader와 package dry-run도 통과했다. 소스는 외부 `codexteams-team-mode-060/product-freeze-a12-manifest.json`의 93개 파일 해시로 고정했다. 실제 Sol task-8의 검토 4는 PASS이며 필요한 구현 수정은 남아 있지 않다. 같은 Pi/Terminal 창 7016에 원래 프로젝트 실행 설정을 바이트 단위로 복원하고 0.6.0을 reload했다.


같은 Pi의 ON 상태에서 일반 텍스트 질문 하나를 보냈고 실제 `openai/gpt-6-astra` high가 답했다. 외부에서 run/resume을 호출하지 않았다. 요청의 origin은 `interactive`, 상태는 `answered`이며 작업 ID는 비어 있다. 질문 전후 기존 작업 8개의 구조와 기존 목표가 같았다. ON은 reload 후에도 유지됐다. 이후 OFF 전환과 reload를 확인했고 일반 텍스트는 기존 부모의 `openai/gpt-6.1-sol`이 직접 답했다. 이 OFF 입력은 coordinator attempt를 추가하지 않았으며 Teams 상태도 바꾸지 않았다. `live-on-comparison.json`, `live-astra-receipt.json`, `live-off-native-receipt.json`에 근거가 있다.

최종 120×30 기본 화면은 팀 모드 OFF·실행 없음·결과 확인 8개를 표시한다. 사용자 수락은 0개이며 실행 중인 worker/coordinator는 없다. 기본 화면 조회 전후 Teams 상태가 같았다. 같은 interactive Pi를 계속 사용했고 별도 테스트 창을 만들지 않았다. `live-home-off-final.png`와 `live-final-summary.json`에 결과가 있다. 실제 계정의 위 두 짧은 답변과 로컬 공급자 fixture의 전체 구현 파이프라인 증명은 서로 다른 검증이다. VoiceOver, 장시간 실제 작업과 최종 사용자 사용성 수락은 확인하지 않았다.

출시 전 읽기 전용 지원 검토에서 README의 기본 화면/상태 명령 구분과 ON 자동 실행 설명 두 곳을 수정했다. 같은 Terra task-7의 문서 전용 13번째 시도가 README와 `.gitignore`만 변경하고 멈췄다. 실제 Sol task-8의 검토 5는 이 변경분을 PASS로 판정했다. `/.pi/settings.json`은 Git에서 제외해 로컬 절대 경로 설정을 보존한다. Root의 `release-delta-hash-check.json`은 a12의 93개 파일 중 README만 달라졌음을 확인했다. 실행 소스·테스트·패키지 metadata가 같아 기존 247개 테스트와 런타임 근거를 재사용한다. 최종 문서·패키지 내용·staging 검사는 commit 전에 수행한다. 사용자의 후속 지시로 현재 `task/team-session-navigation` 브랜치의 commit·push가 승인됐다. 개인 Pi에 설치된 전역 확장은 0.2.1을 유지한다.

Sol 검토 3은 stdin 전달 후 실제 Pi가 내보내는 전체 사용자 echo가 기존 8 MiB JSONL 상한을 넘는 경로를 확인했다. 같은 Terra 작업에서 실제 제출한 prompt와 정확히 같은 사용자 echo만 JSON-escaped prompt 크기와 추가 8 MiB 범위로 허용했다. 일반 record 상한과 assistant 보존 범위는 유지한다. Pi-compatible 전체 message_start/message_end/agent_end, 선행 system message, 잘못된 UTF-8/JSON·위조 echo·잘린 record를 회귀로 검사했다.

실제 Pi의 8 MiB 초과 경계는 `workcheck-runs-a12/echo-a12-01`에서 PASS다. 실제 `runPiWorker`→설치된 Pi JSON CLI→loopback 공급자가 9,437,216바이트 prompt 전체의 바이트 수·SHA-256·내용을 확인한 뒤 정상 응답을 반환했다. SDK session의 사용자 기록, 실제 worker PID 종료, 임시 prompt 디렉터리 정리와 소스 해시도 확인했다. 이 검증은 worker CLI transport 증명이며 아래 Teams/RPC 흐름과 구분한다. 실제 공급자 계정·인증은 사용하지 않았다.

최종 a12의 Teams/RPC `single-a12-01`, `payload-a12-01`, `midwork-a12-01`도 모두 PASS다. 일반 입력 한 번의 실행→검토 FAIL→수정→PASS, check 출력 4개를 포함한 16 KiB 초과 실제 검토, 실제 worker/하위 process 중단 후 동일 작업/세션 재개를 확인했다. 실제 reviewer scope의 변경 지시·acceptance·check 결과·revision/digest가 연결됐다. 부모 poison 호출과 자동 수락은 없고 종료 후 프로세스·잠금이 정리됐다. `installed-node22-final-060-a12-result.json`은 큰 payload의 scope metadata를 별도 fixture에 복사한 Node 22 packaged JS parity와 훼손 거부 PASS다. 원본 RPC 데이터와 제품 파일 93개의 해시는 유지됐다.

Sol 검토 2는 앞선 5개 수정과 기존 수동 큐의 종료 차단을 확인했다. 추가 P2는 reviewer payload가 사용자 수정 지시의 16 KiB 상한에 걸리는 경로였다. 같은 Terra 작업에서 별도 bounded reviewer API와 비공개 파일/stdin 전달을 추가했다. 사용자 수정 지시의 16 KiB 상한은 유지한다. 실제 subprocess로 최대 amendment scope·UTF-8 check tail·24 MiB를 넘는 JSON-escaped payload의 byte/digest 전달을 확인했다. 실패한 수정 전 회귀와 `sol-review2-fail.md`를 보존했다.

새 파일/stdin transport의 `single-a11-01`, `payload-a11-01`, `midwork-a11-01`은 모두 PASS다. 큰 payload 검증은 서로 다른 check 4개의 각 4,000바이트 출력을 두 구현 attempt에서 확인했다. 실제 reviewer user prompt는 19,025바이트와 19,125바이트였으며 전체 scope·check output·truncation flag·request revision·scope/artifact digest가 연결됐다. native write/read, 검토 FAIL→동일 작업 수정→PASS, 실제 중단 후 같은 세션 재개, 사용자 수락 대기와 종료 정리도 확인했다. 부모 poison 모델 호출과 자동 사용자 수락은 없었다.

`installed-node22-final-060-a11-result.json`도 PASS다. 큰 payload RPC의 실제 scope evidence를 별도 fixture로 복사해 ProjectStore와 설치본 packaged JS reader의 구조 검증을 확인했다. 훼손한 scope digest와 mode generation은 거부했고 원본 RPC 데이터는 변경하지 않았다. Pi peer/실행 파일이나 installed TypeScript loader 없이 조회했다. 제품 93개 파일은 검증 전후 같았다. a11의 근거는 `workcheck-runs-a11`와 `final-logs-a11`에 있다. 아래 a10/a8 기록은 해당 당시 소스의 근거다.

실제 Sol의 독립 검토 1은 FAIL이었다. 전체 owner의 종료 fence, stale PASS의 요청별 재검토, amendment를 포함한 실제 reviewer 입력/범위 연결, coordinator의 상태·사용량 표시에서 5개 수정 사항을 확인했다. 같은 Terra 작업에서 수정했고 Root가 추가로 확인한 기존 수동 큐의 내부 scheduling도 동기적으로 abort한다. 실제 Pi SDK로 두 프로젝트를 전환한 뒤 reload하는 회귀, 이전 PASS가 무효가 된 요청의 새 check/검토, scope/revision 연결을 추가했다. `sol-review1-fail.md`와 `terra-attempt10-final.md`에 원문이 있다. 아래 a8 기술 검증은 당시 소스의 근거이며 최종 수락을 뜻하지 않는다.

새 scope를 사용하는 첫 a10 RPC 실행은 검증기의 canonical scope가 `outputTruncated`를 빠뜨려 실패했다. 제품은 reviewer 실패 후 요청을 pause했고 PASS를 만들지 않았다. 제품 소스를 유지하고 외부 adapter를 수정했다. 새 `single-a10-02`와 `midwork-a10-01`은 모두 PASS다. `workcheck-runs-a10`의 각 receipt와 원문을 보존했다. midwork reviewer는 실제 inbound scope의 amendment ID·지시에서 요구값을 읽고 native read 결과와 비교했다. 원래 요청·writer acceptance·선언된 check 결과·request revision·scope digest도 검증했다. 종료 후 worker/하위 PID/lock은 남지 않았고 부모 poison 호출과 자동 사용자 수락은 없었다.

a10 당시 Node 22.19 설치본도 `installed-node22-final-060-a10-result.json`에서 PASS였다. 완료된 native RPC의 scope 근거를 원본과 분리한 fixture에 복사해 ProjectStore와 packaged JS reader의 구조 검증을 확인했다. scope digest를 훼손한 복사본은 거부했다. 원본 RPC 상태는 변경하지 않았다. Pi peer/실행 파일이나 installed TypeScript loader 없이 조회했고 실제 모델 호출은 없었다. 최종 source 파일 92개는 이 검증 전후 같았다.

Node 22.19의 격리 설치 패키지는 Pi peer나 실행 파일 없이 조회했다. 없는 상태를 새로 만들지 않았고, SDK navigation과 ON-mode 요청 metadata가 포함된 상태를 읽었다. 잘못된 mode generation은 packaged JS 검증에서 거부했다. `installed-node22-final-060-a8-result.json`에 결과가 있다. 실제 공급자 호출은 없었다.

일반 입력 한 번의 standalone RPC 검증은 `workcheck-runs-a8/single-a8-02/receipt.json`에서 PASS다. 설정 후 클라이언트는 일반 prompt를 한 번만 전송하고 상태 관찰과 종료만 수행했다. 실제 Pi worker의 native write/read로 첫 구현→검토 `changes_required`→동일 작업/세션 수정→검토 `pass`를 확인했다. 두 검토는 각각 실제 내용 digest와 해당 구현 attempt의 선언된 check에 연결됐다. 기존 수동 작업은 실행하지 않았고 `awaiting_user_acceptance`에서 멈췄다. 부모 poison 모델 호출은 0회이며 종료 후 worker와 잠금이 남지 않았다.

첫 실행은 Pi의 사용자 text-block 배열을 검증기가 문자열로만 가정해 실패했다. 제품 소스를 유지하고 외부 검증기만 수정했으며 `single-a8-01/receipt.json`과 원문을 보존했다.

입력 두 번의 별도 검증도 `workcheck-runs-a8/midwork-a8-01/receipt.json`에서 PASS다. 첫 native writer의 Bash `sleep 30`과 실제 하위 프로세스를 관찰한 뒤 두 번째 일반 입력으로 방향 변경을 요청했다. coordinator의 실제 `interrupt_then_resume` 제안으로 기존 worker가 `aborted`가 됐다. 새 writer 모델 요청 전에 이전 worker와 관찰한 모든 하위 PID가 사라졌고 동시에 살아 있는 writer는 한 개였다. 동일 작업/세션의 새 attempt에 실제 변경 지시가 들어갔으며 native write→선언된 check→별도 reviewer native read/PASS→사용자 수락 대기로 이어졌다. 기존 goal/수동 작업을 유지했고 종료 후 잠금과 프로세스도 정리됐다. 이 검증은 두 입력을 쓰며 위의 단일 입력 증명과 구분한다.

위 fixture 모델 이름과 usage는 로컬 프로토콜 데이터이며 실제 모델 신원이나 판단력을 증명하지 않는다. 런타임 검증 중 고정한 제품 파일 89개는 바뀌지 않았다. 실제 계정의 판단력과 최종 사용자 수락은 별도다.

## 0.5.0 팀 기본 화면 — 2026-11-02

0.5.0 검증 당시 같은 Pi에 로컬 0.5.0을 적용하고 기본 화면을 열어뒀다. `/teams`와 root의 `/teams home`에서 작업을 선택하고 결과 확인·수정 요청·명시적 수락을 고른다. 실행과 검증은 실제 controller operation으로 표시한다. 새 작업 추가는 실행을 시작하지 않으며, 일괄 실행은 요청 시점의 작업 ID 집합만 실행한다.

| 확인 | 결과 |
|---|---|
| 최종 typecheck·전체 suite | **210 통과, 실패 0, 건너뜀 0**. `codexteams-home-paint-check-attempt6-final.log` |
| 실제 Pi loader·pack dry run | 통과. 최종 paint smoke/pack 로그 |
| Node 22.19.0 설치 패키지 | 별도 prefix에서 통과. Pi peer/실행 파일 없이 결과 조회, 없는 상태 비생성, 로컬 fixture 중복 억제, SDK navigation 상태 조회 확인. `installed-node22-final-050-paint-result.json` |
| 독립 검토 | 실제 Sol Review3 PASS 및 paint-delta PASS. 이전 두 FAIL 보존 |
| 실제 같은 Pi 120×30 | 전체 폭 Home, 결과 줄바꿈·PageDown, Esc 복귀, 현재 선택·키 안내 확인 |
| 조회의 비실행 | Home→작업→결과→스크롤→복귀 전후 상태 SHA-256 동일. `ui-final-navigation.json` |
| 실제 controller check | 검증 중과 완료 후 실행 없음 표시를 관찰. **49 통과**, exit 0, 최신 Terra attempt에 연결. 모델 attempt 수·수락 수 불변 |

근거 폴더: [/Users/oozoofrog/.codex/visualizations/2026/11/02/codexteams-usability-050](/Users/oozoofrog/.codex/visualizations/2026/11/02/codexteams-usability-050). 최종 소스·테스트 해시는 `product-final-paint-manifest.json`, 화면은 `home-ready.png`, `result-scrolled.png`, `check-running.png`에 있다. 원시 RED·중간 실패·최종 GREEN 로그는 `final-logs`에 보존했다.

controller check에는 화면 관찰 시간을 확보하는 5초 대기 fixture를 사용한 뒤 실제 Home/controller 회귀를 실행했다. 경과 시간과 실행 상태는 해당 실제 check의 값이다. 실제 운영 작업의 진행률이나 ETA를 만든 것이 아니다.

실제 Astra/테라/솔 모델 개발 기록과 자동 fixture를 구분했다. 설치 probe는 로컬 fixture만 사용했다. 새 UI에서 실제 공급자 응답 스트림 전체와 VoiceOver를 확인한 결과는 없다. 키보드·120×30 화면 확인은 사용자 사용성 수락을 대신하지 않는다. MacPilot의 긴 AX 값 입력 거부 후에는 전경·대상 창을 확인한 네이티브 키 입력과 단계별 화면 재조회로 검증했다. 처음 확인하지 못한 스크롤 결과를 성공으로 남기지 않고 별도 기록을 정정했다.

전역 설치본은 0.2.1을 유지했다. 현재 Pi는 복원한 프로젝트 설정을 통해 이 작업트리의 0.5.0을 불러온 상태다. commit·push·공개 배포와 사용자 수락은 하지 않았다.


## 0.4.0 팀·작업 세션 탐색 — 2026-11-02

구현 소스는 `/Users/oozoofrog/.codex/worktrees/teams-session-navigation/codexteams`다. 최종 제품·테스트 파일60개의 hash를 `terra6-code-sha256.json`에 고정했다. 이후 실제 화면 검증에서도60개 파일이 같았다. 독립 Sol 재검토3은 **PASS**이며 필수 코드 수정은 남지 않았다. 작업의 `needs_review`와 사용자 수락은 별개로 유지한다.

| 범위 | 확인한 결과 |
|---|---|
| 팀·작업 탐색 | 명시적인 팀 행과 계획·작업 자식 행, 상태·모델·실행 이력, 선택·취소·열기·팀 복귀. 긴 경로는 좌우로 확인하고 목록은 높이가 제한된 overlay에서 이동한다. |
| 실제 모델 | 최초 계획은 `openai-codex/gpt-6-astra / high`. 구현은 정확한 `gpt-6.1-terra / high`, 독립 검토는 `gpt-6.1-sol / high`. 사용자 재로그인 뒤 후속 실행은 현재 `openai` ChatGPT 구독 OAuth로 명시적으로 연결했다. 과거 legacy provider receipt와 실패를 보존했다. |
| 최종 자동 검사 | TypeScript 및 **184/184**, 실패·skip0. 관련 회귀 **17/17**, Pi 확장 로더와 package dry-run 통과. |
| 실제 Pi RPC·SDK | 별도 module graph를 거치는 pending worker/check의 new·resume·fork, 같은 root와 연결 root, 새 binding과 registry, readonly clone/fork, quit·reload 정리를 확인했다. SDK의 모의 UI는 실제 Terminal 화면 증거로 분류하지 않는다. |
| 최소 Node 설치본 | Node **22.19.0**의 격리 tarball 설치와 standalone `handoff-result` 통과. Pi peer·실행 파일 없이 조회한다. Root의 별도 설치 확인은 실제 SDK navigation metadata를 가진 state도 읽었다. |
| 현재 Pi 적용 | 사용자의 기존 **PID31653**, Terminal 창6565에서 프로젝트 package filter와 native `/reload`로0.4.0을 읽었다. 추가 대화형 Pi를 열지 않았다. 전후 PID·global settings hash가 같고 `.pi/git` 설치도 발생하지 않았다. |
| 현재 Pi의 실제 실행 유지 | `/teams check`에서 핵심 회귀4개를 실행하고 gate를 기다리는 동안 조회 세션과 팀 root를 오갔다. check ID·PID92968·잠금이 유지됐고 gate 해제 후 **4/4, exit0**으로 완료됐다. 이 check는 최종 Terra attempt6에 연결됐다. |
| 원본·추론·수락 경계 | 위 화면 이동 전후 원본 Sol worker JSONL의 bytes·inode·mtime이 같았다. native root·조회 파일의 assistant 턴은0개였고 작업 시도 수는 `[6,3]`으로 유지됐다. 자동 재개·수락은 없었다. 실제 검토 worker의 정상 append는 별도로 prefix 보존을 확인했다. |

최종 검토 전의 실제 Terminal 검증은 held local protocol worker를 사용했다. 원본 bytes/hash·inode·mtime, PID·시도·잠금을 고정한 채 task view·Esc·native resume·연결 B팀·B의 정확한 parent·A팀 복귀를 확인했다. 이 fixture는 `localfixture/session-nav-proof`이며 AI 추론을 하지 않는다. 실제 Astra/Terra/Sol 개발과 구분한다. 사용자의 단일 터미널 요청 뒤에는 현재 Pi의 reload와 실제 controller check로 마지막 화면을 확인했다.

실패를 보존했다. 첫 미완료 반환, review1·review2 FAIL, legacy quota 실패와 새 RED fixture의120초 timeout이 포함된다. timeout은 fixture의 누락된 outcome·정리 경로를 보완하고 제한 시간 안에 종료되는 RED로 다시 확인했다. worker guard는 약화하지 않았다. stale registry 테스트의 폐기된 알림 단언은 production registry 결함의 증거로 주장하지 않는다.

현재 host는 일반 `pi`의 프로젝트 발견 모드다. 실행 중 다른 root로 떠나는 전환은 문서화한 안전 제한을 따른다. 전용 launcher의 검증된 absolute `-e`·discovery 비활성화 구성과 구분한다. 현재 세션의 프로젝트 신뢰만 사용했으며 요청한 Normal provider 실행 등급이나 서버 내부 모델 attestation은 확인하지 않았다.

지속 보관 근거: `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-sessions-0.4.0/`. 주요 파일은 `review3-result.md`, `terra6-code-sha256.json`, `single-terminal-final-runtime.json`, `single-terminal-check-in-view.json`, `single-terminal-controller-check.log`다. 자동 검사 전체 로그는 `logs/codexteams-sessions-rework4-*-final.log`에 있다. 프로젝트 실행 설정은 `.pi/settings.json`이며 전역 설치를 교체하지 않는다.

## 0.3.0 Codex 인계와 실제 Teams 자체 개선 — 2026-11-01

구현은 `/Users/oozoofrog/.codex/worktrees/codex-teams-handoff/codexteams`에 있다. 원본 checkout의 commit `29405bc`와 추적 파일은 유지했다. 당시 Terminal은 검증된 새 소스의 확장을 명시적으로 로드했다.

| 범위 | 확인한 결과 |
|---|---|
| 실제 Teams 계획 | `openai-codex/gpt-6-astra`, high. 실제 반환 모델 식별자가 요청과 일치했다. |
| 실제 Teams 구현·수정 | 같은 작업·Pi worker 세션에서 `openai-codex/gpt-6.1-terra`, high로 4회 실행했다. 첫 tests-only 결과는 미완료로 보존하고 Sol 검토를 반영해 재개했다. |
| 실제 Teams 독립 검토 | `openai-codex/gpt-6.1-sol`, high로 4회 검토했다. 응답 검증·저장 상태 검증·동시 요청·ENOENT 경계 결함을 수정한 후 마지막 재검토에서 차단 항목이 없음을 확인했다. |
| 최종 자동 검사 | TypeScript와 전체 **160/160**, 실패·skip 0. 실제 Pi 로더, package dry-run, diff whitespace 검사 통과. |
| 실제 controller check | Codex가 Terminal의 `/teams check`로 핵심 회귀 **9/9**를 실행했다. exit 0과 마지막 Terra attempt에 연결된 check 기록을 확인했다. |
| 최소 Node 설치 환경 | Node **22.19.0**에서 실제 tarball을 격리된 global prefix에 설치했다. 물리 Pi peer가 없고 Pi 실행 경로가 없는 환경에서 absent-state 비생성과 저장 결과 조회가 통과했다. 마지막 ENOENT 수정 후 다시 패키징해 확인했다. |
| 실제 계정 인계 | 별도 읽기 전용 fixture에서 새 CLI로 Codex 요청을 제출했다. Sol이 실제 `read` 도구로 README의 prompt에 없던 값을 읽고 반환했다. 재제출·Pi 없는 조회 후에도 attempt는 **1개**였다. |
| 수락 경계 | 제품 작업과 실제 계정 fixture는 `needs_review`로 남았다. 자동 수락은 하지 않았다. 검토 PASS와 사용자 수락을 구분한다. |

실제 모델 사용은 Pi의 공개 응답에서 받은 `effectiveModels`와 usage 기록으로 확인했다. 이는 서버 구현의 별도 attestation이나 청구서가 아니다. 요청한 Normal 서비스 모드의 provider 실행은 별도로 검증하지 않았다.

수정 전 실패는 보존했다. 대표 근거는 `/tmp/codexteams-handoff-red.log`, `review2-red.log`, `enoent-red.log`이며 각각 전체 경로의 공통 접두사는 `/tmp/codexteams-handoff-`다. 마지막 검증 로그는 `/tmp/codexteams-handoff-enoent-final-{focused,typecheck,check,load,pack}.log`다. Codex가 손상된 source root의 조회 우회를 별도 fixture로 재현한 뒤 수정 후 store·조회·CLI 거부 회귀를 확인했다.

지속 보관 근거는 `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-selfhost-0.3.0/`에 있다. `installed-node22-final-result.json`은 최종 설치 검사, `live-verification-result.json`은 실제 계정 인계 검사다. 자동 통합 검사의 local provider fixture와 실제 계정 실행을 구분한다.

요청 파일은 호출자가 관리하는 디렉터리에 둔다. 최종 파일의 nofollow·descriptor identity·bounded read 검사와 CLI→Pi digest 연결을 제공한다. 부모 디렉터리의 원자적 open이나 악성 동일 사용자 프로세스에 대한 OS sandbox는 제공하지 않는다. `source.stopped`는 발신자 선언이며 외부 Codex 프로세스의 정지를 증명하지 않는다. 상세 계약과 사용법은 `docs/design/2026-11-01-codex-handoff.md`, `docs/codex-handoff.md`에 있다.

## 0.2.1 resume picker — 2026-11-01

- `/teams resume`는 Pi의 선택 목록을 연다. 실패·중단·검토 대기 작업만 표시하고 제목·상태·역할·보조 ID로 구분한다. ↑/↓·Enter·Esc로 선택·재개·취소한다. 직접 ID와 수정 지시를 지정하는 기존 방식은 유지한다.
- TypeScript와 전체 테스트 **138개 통과 / 실패 0 / 건너뜀 0**. 새 picker 회귀 21개를 포함한 관련 테스트 32개 통과. 실제 Pi 로더와 패키지 구성 검사도 통과했다.
- 빈 상태·단일 후보·같은 제목·선택 취소·비대화형 목록·신뢰/실행/복구/소유권·선택 중 세션/프로젝트/상태 변경을 검증했다. 독립 검토에서 중대한 picker 결함은 보고되지 않았다. 버전 증가 후 남아 있던 launcher의 0.2.0 기대값을 0.2.1로 수정하고 전체 검사를 통과했다.
- 실제 Pi TTY에서 합성 실패 작업 두 개의 목록을 열고 두 번째 작업을 선택했다. 선택한 designer 역할에만 지정한 존재하지 않는 모델의 preflight 오류로 정확한 대상 라우팅을 확인했다. 다시 목록을 열어 Esc로 취소하고 Ctrl-D로 정상 종료했다. 상태 파일은 전후 바이트가 같고 소유 잠금은 해제됐다. 이 TTY 검증은 실제 모델 재개 실행을 포함하지 않는다.
- 증거: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/resume-picker-0.2.1](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/resume-picker-0.2.1). RED, 중간 버전 실패, 최종 GREEN, TTY 원문·읽기용 기록과 요약을 보존했다.

## 0.2.0 launcher — 2026-11-01

기준 커밋 `7c13df9`에서 실행 명령, 계획·실행 연결과 설치 안내를 추가했다. 환경은 macOS 27.2, Node v26.12.1, Pi 1.4.0이다.

| 검증 | 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, **117개 통과 / 실패 0 / 건너뜀 0** |
| 실제 Pi 로더 | 확장 1개, `teams` 명령과 조회 도구 등록, 오류 0 |
| npm 패키지 구성 | `bin/codexteams.mjs`와 소스 포함. 설치된 명령의 버전 0.2.0 확인 |
| 물리 Pi peer가 없는 설치본 | tarball을 격리 npm prefix에 설치. 실제 Pi와 loopback 프로토콜 fixture로 상태 조회·계획·worker Bash·검토 대기·잠금 해제·기존 상태 보존 통과 |
| 실제 TTY | Pi TUI의 codexteams 안내 표시, Ctrl-D 정상 종료, 프로젝트 상태 생성 없음 |
| 실제 Mac 설치 스크립트 | 별도 대상·npm prefix·Pi 설정에서 복사, 의존성 설치, CLI와 일반 Pi 확장 등록, 버전·조회 확인 |
| 공개 GitHub 설치 명령 | `718aad4` 푸시 후 README의 npm Git 설치를 별도 prefix에서 실행. CLI 0.2.0·소스 일치·실제 Pi 조회 확인. 물리 Pi peer 복사본·모델 호출·프로젝트 상태 생성 없음 |
| 독립 검토 | 세 작업의 요구사항·코드 품질 PASS. 아래 두 지적 수정 후 남은 중대한 결함 없음 |

### 수정한 경계 조건

- 계획부터 첫 작업까지 하나의 취소 단위로 묶었다. 계획 중 추가는 차단하고 실행 중 추가는 허용한다. 계획 직후 취소·종료·소유권 상실 시 worker를 시작하지 않는다.
- 기존 목표·작업·계획 이력은 표시하며 자동 재계획·재시도하지 않는다. 프로필만 설정된 프로젝트는 첫 목표를 시작할 수 있다. 사용자 수락과 복구 확인을 유지한다.
- Pi가 파이프 입력을 초기 slash command 앞에 붙이면 일반 모델 프롬프트가 되는 경로를 발견했다. 비어 있지 않은 비TTY 입력은 Pi 실행 전에 거부한다.
- Pi text print mode는 확장의 custom 메시지를 출력하지 않는다. 비TTY 입출력은 명시적으로 JSONL을 선택한다. 실제 설치본의 조회·실패·완료 출력으로 검증했다.
- 원래 tar 파이프에서 `Write error`를 재현했다. private 임시 archive를 만든 뒤 추출하고 EXIT trap으로 정리하도록 바꿨다. 정확한 기존 파이프 실패 원인은 확정하지 않았다.

전체 RED·중간 실패·GREEN 로그와 TTY 기록: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/launcher-0.2.0](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/launcher-0.2.0). 로컬 프로토콜 fixture는 HTTP 요청 3회로 계획 응답·Bash 도구 요청·최종 응답을 반환했다. 유료 모델이나 실제 계정 인증은 사용하지 않았다.

실제 계정 모델 entitlement·청구, 대화형 TUI에서 목표 실행부터 취소까지의 전체 흐름, Node 최소 버전 22.19.0 자체와 Windows는 검증하지 않았다. TTY 표시와 로컬 프로토콜 성공을 이 범위의 검증으로 확대하지 않는다.

## macOS 후속 검증 — 2026-11-01

대상 소스: `/Volumes/eyedisk/develop/oozoofrog/codexteams`. 원본 초기 커밋은 `95a1e6e`이며 작업 브랜치는 `implementation/macos-validation`이다. Rust 전환 가능성을 검토한 뒤 사용자는 TypeScript 유지를 선택했다.

환경: macOS 27.2 (26B123), Node v26.12.1, npm 11.20.0, Pi 1.4.0. 의존성 122개를 lockfile로 설치했다. Node 최소 지원 버전 22.19.0 자체의 실행은 검증하지 않았다.

| 검증 | 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, **77개 통과 / 실패 0 / 건너뜀 0** |
| `npm run smoke:load` | exit 0. 실제 Pi 로더 오류 0, `teams` 명령과 `codexteams_status` 도구 등록 |
| `npm run pack:check` | exit 0. 패키지 구성 확인, 공개 배포 없음 |
| `git diff --check` | 공백 오류 없음 |
| 실제 Pi host 자동 테스트 | 격리된 설정에 로컬 패키지 등록 후 `help`, `status`, `add`, `profile`, `show` 실행. 상태·프로필 저장과 종료 후 잠금 해제 확인 |
| GitHub URL 설치 안내 | 공개 저장소 URL로 실제 `install`, `list`, `help/status`, `update`, `remove` 통과. 별도 Pi 설정·인증 환경 변수 없는 프로세스 사용. 모델 실행 0회, 프로젝트 상태 생성 없음 |
| 실제 Mac 설치 스크립트 | 임시 대상에 소스 복사, `npm ci`, 격리된 Pi 설정의 패키지 등록 완료. 실제 사용자의 Pi 설정은 변경하지 않음 |
| 독립 코드 검토 | 현재 변경에 중대한 결함 없음. 별도 실행한 controller/runner 테스트 52개 통과. 계획 취소 중 추가 차단·취소 후 추가 허용·검증 실행 중 추가 허용도 확인 |

### 변경과 회귀 검증

- 계획 생성 중 `add`가 같은 작업 ID를 만들면 계획 게시가 실패하고 재시도가 막혔다. 실패 테스트로 재현한 뒤 계획 생성 중에만 추가를 차단했다. 일반 worker와 검증 실행 중에는 추가를 허용한다.
- macOS의 `/var`와 `/private/var`는 같은 폴더를 가리킬 수 있다. worker cwd 테스트가 실제 경로를 비교하도록 수정했다.
- 실제 Pi CLI 통합 테스트는 별도 `PI_CODING_AGENT_DIR`을 사용하며 공급자 인증 환경 변수를 전달하지 않는다. JSONL에 모델 실행 시작이 없고 작업 attempt도 생성되지 않았음을 확인한다.
- 통합 테스트의 첫 실행은 stdin pipe가 열린 채여서 Pi의 EOF 대기 중 timeout이 발생했다. 테스트가 stdin을 닫도록 수정한 뒤 단독 실행과 전체 실행이 통과했다. production 코드는 변경하지 않았다.
- 중간 전체 실행에서 설치 복사 테스트가 한 차례 실패했다. 원인은 확정하지 못했다. 단독 재검사와 이후 전체 76개·77개 테스트 실행은 통과했다. 오류 출력을 assertion에 포함해 다음 실패의 원인을 남기도록 했다.
- 검증 종료 후 background writer가 남을 수 있다는 우려는 12회의 실제 프로세스 관찰에서 재현되지 않았다. 관련 production 코드는 변경하지 않았다.

### 근거와 검증 경계

전체 로그는 다음 폴더에 보존했다: [/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification](/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification). 주요 파일은 `baseline-check.log`, `planning-red.log`, `controller-green.log`, `intermediate-check-installer-failure.log`, `host-test-stdin-failure.log`, `final-check.log`, `macos-install.log`, `registered-host.jsonl`이다. 실패 기록을 삭제하지 않았다.

README의 GitHub 직접 설치 절차는 `remote-install-readme.log`와 `remote-install-readme-summary.json`에 기록했다. 검증한 원격 소스는 `1c3ebff`의 코드이며 이후 변경은 설치 안내 문서다. 이 확인은 원격 설치본의 모델 worker 실행을 검증한 결과가 아니다.

macOS CLI·프로세스 그룹·설치·상태 저장 검증을 실제로 실행했다. 대화형 TUI의 시각적 사용성, 실제 사용자의 Pi 등록·reload, 로그인 계정 모델 호출·entitlement·청구는 확인하지 않았다. 유료 모델 호출과 외부 게시를 하지 않았다. 병렬 worktree, 자동 수락, 자동 모델 배정과 Ultra 전략은 기존 후속 범위로 남긴다.

## 이전 Linux 전달본 기록

검증일: 2026-11-01. 대상: 이 소스 패키지의 첫 Pi 확장 구현.

### 최종 결과

| 검증 | 실제 실행 결과 |
|---|---|
| `npm run check` | exit 0. TypeScript 통과, 테스트 **74개 통과 / 실패 0 / 건너뜀 0** |
| `npm run smoke:load` | exit 0. 실제 Pi 로더에서 확장 1개, `teams` 명령, `codexteams_status` 도구 등록. 로딩 오류 0 |
| worker 전용 guard 로딩 | 위 74개 테스트에 포함. 실제 Pi `DefaultResourceLoader`에서 discovery 비활성화 + 명시적 guard 로딩, Bash override만 등록 |
| `NPM_CONFIG_CACHE=/tmp/codexteams-npm-cache npm run pack:check` | exit 0. npm 패키지 구성 확인. 공개 배포하지 않음 |
| Mac 설치 스크립트의 소스 복사 | Linux의 `--copy-only` 테스트 통과. 새 폴더 생성, 의존성·Git 이력 제외, 기존 프로젝트 덮어쓰기 거부 확인 |
| `git diff --check` | 공백 오류 없음 |

실제 Pi 로더 출력은 `docs/load-smoke-result.json`에 보관했다. npm 패키지 점검은 설치용 파일 집합 검사다. 사용자에게 전달하는 ZIP은 개발을 이어갈 수 있도록 테스트·TypeScript 설정·lockfile도 포함한 전체 소스다.

### 실행 환경

- Linux, Node 24.22.1. 패키지가 선언한 최소 Node 버전은 22.19.0이며, 최소 버전 자체를 별도로 실행 검증하지는 않았다.
- `@earendil-works/pi-coding-agent` 1.4.0, `@earendil-works/pi-ai` 1.4.0.
- TypeScript 5.9.3, TypeBox 1.3.27. 의존성은 `package-lock.json`으로 고정.
- 프로세스 정리 검증과 최종 전체 테스트는 실제 OS PID/PGID를 제공하는 승인된 실행 경로에서 수행했다.
- 기본 관리 환경에서는 Node PID와 OS `ps` 정보가 다르고 child 출력 전달이 제한되는 현상을 확인했다. 실패한 `ps` 조회를 '프로세스가 종료됨'으로 간주하지 않도록 테스트를 수정했다. production의 소유권 확인 조건은 약화하지 않았다.
- npm 패키지 점검의 기본 캐시 경로는 쓰기 불가능했으므로 쓰기 가능한 임시 캐시 경로를 명시해 성공시켰다. 소스 결함이나 배포 실패로 처리하지 않는다.

### 검증한 동작

1. 목표 → 읽기 전용 계획 → 엄격한 JSON/DAG 검증 → 작업 저장 → 실행 → 검토 대기 → 사용자 수락 → 의존 작업 해제.
2. 역할별 명시적 모델·effort, capability 실패 시 호출 방지, `ultra`를 실제 effort로 보내지 않음.
3. 동일 프로젝트 소유자 잠금, 원자적 저장, 손상 상태 보존, symlink 거부, 중첩 실행 기록 검증.
4. 실패·취소·강제 종료 복구, 새 attempt로 수정 재개, 실행 당시 프로필과 이전 시도 보존.
5. 실제 subprocess의 JSONL, 분할 UTF-8, 정상 exit에 포함된 모델 오류, 불완전 출력, 출력 크기 경계, 자식 실행 실패.
6. 실제 Pi BashToolDefinition의 native 결과 형태, shell 설정·환경·cwd 보존, 일반 백그라운드 자식 정리, 도구 취소·명시적 timeout의 전체 attempt 종료.
7. 검증 shell의 실제 종료 코드·출력·취소와 background pipe 정리. worker와 검증의 동시 쓰기 차단.
8. assistant 최종 사용량만 합산, 스트리밍 중복 제외, reasoning 이중 합산 방지, 실패·중단의 미확인 사용량 보존, 실행 중 부분 합계 저장.
9. 직접 사용자 명령에만 실행·검증·수락을 제공하고, 모델에 노출되는 조회 도구는 읽기 전용으로 유지.

### 독립 검토에서 수정한 결함

| 재현한 결함 | 수정과 회귀 검증 |
|---|---|
| native Pi Bash의 일반 background process가 worker 그룹에서 빠져나가 작업 후에도 남음 | private guard가 검증된 worker 그룹을 상속하는 Bash operations를 사용. 실제 native 도구 기반 실패 재현 후 정상 완료·취소·timeout 사례 통과 |
| 검증 shell은 종료됐지만 background child가 pipe를 잡아 `close`가 오지 않음 | shell `exit`에서 정리를 시작하고 실제 `close`까지 확인 |
| 중첩 attempt/check 손상과 미완료 attempt의 외부 status 불일치가 복구를 우회 | 중첩 필드·참조·관계 검증, outer status와 독립적으로 미완료 attempt 복구 판정 |
| 복구 대기 중 작업을 수락할 수 있음 | recoveryRequired 동안 accept 차단 |
| 취소와 저장 오류가 동시에 발생할 때 실패가 가려질 수 있음 | 이미 확인된 실패 분류 보존 |
| 진행 중 확정된 응답 사용량이 최종 종료 전 상태 파일에 남지 않음 | 응답 완료마다 partial 합계를 저장 |

최종 guard 범위의 독립 검토에서는 남은 Important/Critical lifecycle·ownership 결함이 보고되지 않았다. 이는 아래 미검증 환경까지 보장한다는 뜻은 아니다.

### 아직 검증하지 않은 사항

- 사용자 Mac의 `eyedisk/develop/codexteams` 생성·설치, 실제 macOS TUI 표시·상호작용.
- 사용자 계정의 Terra/Sol/Astra entitlement, 실제 로그인 모델 호출, 공급자 청구/플랜 차감.
- 실제 디스크 관리 앱 전체 구현. README의 디스크 앱은 사용 시나리오다.
- macOS 자체의 프로세스 그룹 동작과 Windows 프로세스 트리. 첫 실제 Mac 실행에서 확인할 항목이다.
- 악의적 `setsid` 등 의도적인 프로세스 그룹 이탈 방어. 이 확장은 OS sandbox가 아니다.
- 병렬 worktree 통합, 자동 인수 판정, 자동 난도 판정·모델 승격, Ultra 전략. 현재 구현 범위에 포함하지 않았다.

테스트와 로더 검증에서는 유료 모델 호출, 사용자 인증 변경, 외부 저장소 게시를 하지 않았다. 다음 실제 실행 단계는 `docs/WORK_HANDOFF.md`에 정리했다.
