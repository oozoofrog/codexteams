import { normalizeRequest, requestDigest } from './handoff.mjs';
import { isAbsolute, normalize, extname, join, sep } from 'node:path';

const statuses = new Set(['queued', 'running', 'needs_review', 'completed', 'failed', 'interrupted', 'cancelled']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const validPid = value => value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
function validateProfile(p) {
  if (!p || typeof p !== 'object') throw new Error('모델 프로필이 필요합니다.');
  for (const key of ['provider', 'model']) if (typeof p[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(p[key])) throw new Error(`잘못된 ${key}: provider/model을 명시하세요.`);
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(p.effort)) throw new Error('지원 추론 단계: low, medium, high, xhigh, max. ultra는 물리 추론 단계가 아닙니다.');
}
export function validateUsage(usage) {
  if (!usage || !['known', 'partial', 'unknown'].includes(usage.completeness) || !Number.isSafeInteger(usage.responses) || usage.responses < 0) throw new Error('손상된 사용량 state입니다.');
  for (const name of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens', 'costUsd']) { const value = usage[name]; if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('손상된 사용량 state입니다.'); }
}
export function validateAttempt(attempt, seen) {
  if (!attempt || !validId(attempt.id) || seen.has(attempt.id) || !validId(attempt.sessionId) || !validDate(attempt.startedAt) || !validPid(attempt.workerPid) || typeof attempt.text !== 'string' || !Array.isArray(attempt.effectiveModels) || attempt.effectiveModels.some(m => typeof m !== 'string') || attempt.logFile !== `logs/${attempt.id}.jsonl`) throw new Error('손상된 실행 시도 state입니다.');
  if (attempt.endedAt !== undefined && (!validDate(attempt.endedAt) || !['success', 'failed', 'aborted'].includes(attempt.outcome))) throw new Error('실행 종료 state가 일치하지 않습니다.');
  if (attempt.outcome !== undefined && !attempt.endedAt) throw new Error('실행 종료 시각이 없는 state입니다.');
  if (attempt.error !== undefined && typeof attempt.error !== 'string') throw new Error('손상된 실행 오류 state입니다.');
  if (attempt.recoveryPending !== undefined && typeof attempt.recoveryPending !== 'boolean') throw new Error('손상된 복구 state입니다.');
  validateProfile(attempt.profile); validateUsage(attempt.usage); seen.add(attempt.id);
}
export function validateCheck(check, attempts, seen) {
  if (!check || !validId(check.id) || seen.has(check.id) || typeof check.command !== 'string' || !check.command.trim() || !attempts.some(a => a.id === check.attemptId) || !validDate(check.startedAt) || !validPid(check.workerPid) || typeof check.output !== 'string' || !['running', 'passed', 'failed', 'interrupted'].includes(check.status)) throw new Error('손상된 검증 state입니다.');
  if (check.exitCode !== null && !Number.isInteger(check.exitCode)) throw new Error('잘못된 검증 종료 코드입니다.');
  if (check.status === 'running' ? check.endedAt !== undefined || check.exitCode !== null : !validDate(check.endedAt)) throw new Error('검증 종료 state가 일치하지 않습니다.');
  if (check.status === 'passed' && check.exitCode !== 0) throw new Error('통과 검증의 종료 코드가 0이 아닙니다.');
  if (check.status === 'failed' && check.exitCode === 0) throw new Error('실패 검증의 종료 코드가 0입니다.');
  seen.add(check.id);
}
export function validateObservation(observation, attempts) {
  if (!observation || !validDate(observation.at) || !attempts.some(a => a?.id === observation.attemptId) || !['before', 'after'].includes(observation.phase) || !['available', 'unavailable', 'truncated'].includes(observation.status) || typeof observation.gitStatus !== 'string' || Buffer.byteLength(observation.gitStatus) > 32768 || typeof observation.diffSummary !== 'string' || Buffer.byteLength(observation.diffSummary) > 32768 || (observation.error !== undefined && (typeof observation.error !== 'string' || Buffer.byteLength(observation.error) > 4096))) throw new Error('손상된 handoff 관찰 state입니다.');
}
export function validateState(state, root) {
  if (!state || state.schemaVersion !== 1 || state.root !== root || !validId(state.id) || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.goal !== 'string' || !validDate(state.createdAt) || !validDate(state.updatedAt) || !Array.isArray(state.tasks) || !Array.isArray(state.planningAttempts) || !state.profiles || (state.recoveryRequired !== undefined && typeof state.recoveryRequired !== 'boolean')) throw new Error('지원하지 않거나 손상된 프로젝트 state입니다.');
  for (const role of ['planner', 'developer', 'designer', 'reviewer']) validateProfile(state.profiles[role]);
  const ids = new Set(), handoffIds = new Set(), attemptIds = new Set(), checkIds = new Set();
  for (const attempt of state.planningAttempts) validateAttempt(attempt, attemptIds);
  for (const task of state.tasks) {
    if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(task.id) || ids.has(task.id) || !statuses.has(task.status) || !['developer', 'designer', 'reviewer'].includes(task.role) || typeof task.title !== 'string' || !task.title.trim() || typeof task.description !== 'string' || !task.description.trim() || !validDate(task.createdAt) || !validDate(task.updatedAt) || !Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some(a => typeof a !== 'string' || !a.trim()) || !Array.isArray(task.dependsOn) || task.dependsOn.some(d => typeof d !== 'string') || new Set(task.dependsOn).size !== task.dependsOn.length || !Array.isArray(task.attempts) || !Array.isArray(task.checks)) throw new Error('손상된 작업 state입니다.');
    if (task.handoff !== undefined) {
      const h = task.handoff; if (!h || typeof h !== 'object') throw new Error('손상된 handoff state입니다.');
      const request = normalizeRequest(h.request, root);
      if (handoffIds.has(request.requestId) || requestDigest(request) !== h.digest || !validDate(h.submittedAt) || task.title !== request.task.title || task.description !== request.task.description || task.role !== request.task.role || JSON.stringify(task.acceptance) !== JSON.stringify(request.task.acceptance) || task.dependsOn.length !== 0 || !Array.isArray(h.errors) || h.errors.length > 64 || h.errors.some(e => typeof e !== 'string' || Buffer.byteLength(e) > 4096) || !Array.isArray(h.observations) || h.observations.length > 256) throw new Error('손상된 handoff state입니다.');
      for (const observation of h.observations) validateObservation(observation, task.attempts);
      handoffIds.add(request.requestId);
    }
    for (const attempt of task.attempts) validateAttempt(attempt, attemptIds);
    for (const check of task.checks) validateCheck(check, task.attempts, checkIds);
    const latest = task.attempts.at(-1);
    if (['needs_review', 'completed'].includes(task.status) && (!latest || latest.outcome !== 'success' || !latest.endedAt)) throw new Error('검토·완료 상태에 성공한 실행 기록이 없습니다.');
    if (task.status === 'completed' && (!validDate(task.acceptedAt) || task.acceptanceSource !== 'user' || task.acceptedAttemptId !== latest.id || !Array.isArray(task.acceptedCheckIds) || task.acceptedCheckIds.some(id => !task.checks.some(c => c.id === id && c.attemptId === latest.id)))) throw new Error('작업 수락 증거 state가 일치하지 않습니다.');
    ids.add(task.id);
  }
  if (state.navigation !== undefined) {
    const nav = state.navigation;
    const workerDir = join(root, '.codexteams', 'sessions') + sep;
    const validPath = p => typeof p === 'string' && isAbsolute(p) && normalize(p) === p && extname(p) === '.jsonl' && !p.includes('\0') && !p.startsWith(workerDir);
    if (!nav || !nav.root || !validId(nav.root.id) || !validPath(nav.root.file) || !Array.isArray(nav.views)) throw new Error('손상된 탐색 state입니다.');
    const sessions = new Set([nav.root.id]), files = new Set([nav.root.file]), targets = new Set();
    for (const view of nav.views) {
      const target = view?.kind === 'task' ? state.tasks.find(t => t.id === view.targetId) : view?.kind === 'planning' ? state.planningAttempts.find(a => a.id === view.targetId) : undefined;
      const worker = view?.kind === 'task' ? target?.attempts?.some(a => a.sessionId === view.workerSessionId) : target?.sessionId === view?.workerSessionId;
      const key = `${view?.kind}:${view?.targetId}`;
      if (!target || !validId(view.sessionId) || !validPath(view.file) || view.parentSession !== nav.root.file || sessions.has(view.sessionId) || files.has(view.file) || targets.has(key) || (view.workerSessionId !== undefined && (!validId(view.workerSessionId) || !worker))) throw new Error('손상된 조회 세션 state입니다.');
      sessions.add(view.sessionId); files.add(view.file); targets.add(key);
    }
  }
  for (const task of state.tasks) if (task.dependsOn.some(id => !ids.has(id))) throw new Error('state 의존 작업이 없습니다.');
  const byId = new Map(state.tasks.map(task => [task.id, task])), complete = new Set(), active = new Set();
  function visit(id) { if (active.has(id)) throw new Error('state 작업 의존성에 cycle이 있습니다.'); if (complete.has(id)) return; active.add(id); for (const dependency of byId.get(id).dependsOn) visit(dependency); active.delete(id); complete.add(id); }
  for (const id of ids) visit(id);
}
