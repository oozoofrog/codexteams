# Codex 인계와 결과 조회

Codex 작업을 중단한 뒤 절대 경로의 UTF-8 JSON 파일을 작성합니다. `projectRoot`는 현재 프로젝트의 canonical 경로여야 합니다. `source.checkpoint`는 필수 문자열입니다. `stopped: true`는 발신자의 선언이며 다른 프로세스의 정지를 증명하지 않습니다. 파일과 근거 목록은 참조 문자열입니다. Teams는 이 경로를 자동으로 읽거나 실행하지 않습니다.

```json
{
  "schemaVersion": 1,
  "requestId": "change-1",
  "projectRoot": "/absolute/project",
  "source": { "kind": "codex", "stopped": true, "checkpoint": "reviewed" },
  "goal": "Implement the requested change",
  "task": { "title": "Implement change", "description": "Inspect existing code and implement the change", "role": "developer", "acceptance": ["The requested behavior is covered by tests"] },
  "context": { "summary": "Current context", "completed": [], "constraints": [], "files": ["src/example.ts"], "evidence": [] }
}
```

프로젝트에서 `codexteams --handoff /absolute/request.json`을 실행합니다. `--pi /path/to/pi`로 Pi를 선택할 수 있습니다. 결과 JSON 한 개가 stdout으로 나옵니다. 진단은 stderr로 나옵니다. Pi 내부에서는 `/teams handoff "/absolute/request.json"`을 사용합니다. 경로는 JSON 문자열이어야 합니다. 요청은 최대 64 KiB의 일반 파일이어야 하며 심볼릭 링크를 허용하지 않습니다. 경로 구성 요소의 교체를 전후 검사하지만 원자적인 디렉터리 상대 열기는 사용하지 않습니다. 신뢰할 수 없는 프로세스가 요청 파일의 상위 디렉터리를 동시에 바꿀 수 있는 위치는 사용하지 마세요. 같은 ID와 같은 내용은 기존 결과를 반환합니다. 같은 ID와 다른 내용은 거부합니다.

`codexteams --handoff-result change-1` 또는 `/teams handoff-result change-1`은 저장된 결과만 조회합니다. 상태가 없으면 다음과 같은 결과를 반환합니다.

```json
{"schemaVersion":1,"kind":"codexteams.handoff.result","requestId":"change-1","status":"not_found","project":{"id":null,"root":"/absolute/project","revision":null},"task":null,"recoveryRequired":false,"limitations":["No matching persisted handoff."]}
```

실행 결과에는 task 상태, 시도와 요청 프로필, 관찰된 모델, 사용량, worker 결과, 실제 controller checks와 저장된 Git 관찰이 포함됩니다. 알려지지 않은 사용량은 null입니다. Worker의 검증 설명은 자체 보고이며 controller check와 다릅니다. Git 전후 관찰에는 기존 변경도 포함됩니다. 관찰만으로 변경 작성자를 판단할 수 없습니다. 비 Git 저장소와 관찰 실패도 표시됩니다.

정상 실행은 `needs_review`에서 멈춥니다. Codex 또는 독립 검토자가 실제 파일, diff 및 검증 근거를 검토해야 합니다. 수정은 Pi에서 `/teams resume <task-id> <instruction>`으로 명시합니다. 예약 직후 중단된 queued 작업도 `/teams resume <task-id>`로만 실행합니다. 재제출이나 일반 run은 실행하지 않습니다. 비정상 종료로 복구가 필요하면 이전 프로세스와 파일을 확인하고 `/teams recover`를 사용합니다. 최종 수락은 사용자가 `/teams accept <task-id>`로 수행합니다.

종료 코드: 0은 검토 대기 또는 이미 수락된 실행입니다. 1은 실패, 중단 또는 예약만 된 실행입니다. 2는 요청 거부입니다. 3은 Pi JSONL 결과 누락, 중복 또는 불일치 같은 프로토콜 실패입니다. 조회의 `not_found`는 정상 조회입니다. 잘못된 CLI 옵션은 1입니다. 유효한 인계 요청을 읽은 뒤 Pi 시작에 실패하면 3입니다.
