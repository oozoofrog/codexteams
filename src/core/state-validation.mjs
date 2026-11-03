import { normalizeRequest, requestDigest } from './handoff.mjs';
import { isAbsolute, normalize, extname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

export function reviewScope(request, writer, checkIds, tasks = []) {
  const reviewer = request.stages && tasks.find(task => task.id === request.taskIds[1]);
  const reviewerSpec = reviewer && { id: reviewer.id, title: reviewer.title, description: reviewer.description, acceptance: reviewer.acceptance };
  return { ...(reviewerSpec ? { reviewer: reviewerSpec } : {}), ...(request.stages ? { stages: request.stages.map(id => { const task = tasks.find(t => t.id === id); const attempt = task?.attempts.at(-1); if (!task || !attempt) throw new Error('단계 실행 근거가 없습니다.'); return { taskId: id, attemptId: attempt.id, role: task.role, title: task.title, description: task.description, acceptance: task.acceptance, result: attempt.text }; }) } : {}), requestText: request.text, amendments: (request.amendments ?? []).filter(a => a.status === 'applied').map(a => ({ requestId: a.requestId, instruction: a.instruction, ...(a.checks ? { checks: { previous: a.previousChecks, next: a.checks, reason: a.checksReason } } : {}) })), writer: { id: writer.id, title: writer.title, description: writer.description, acceptance: writer.acceptance }, checks: checkIds.map(id => { const check = writer.checks.find(c => c.id === id); if (!check) throw new Error('검토 검증 근거가 없습니다.'); return { id: check.id, command: check.command, status: check.status, exitCode: check.exitCode, output: check.output.slice(-4000), outputTruncated: check.output.length > 4000 }; }) };
}
export function reviewScopeDigest(scope) { return createHash('sha256').update(JSON.stringify(scope)).digest('hex'); }

/** Current receipts and pre-0.7 receipt-less user acceptance are both immutable history. */
export function isAcceptedRequest(state, request) {
  if (request.status === 'accepted') return true;
  const writer = state.tasks.find(task => task.id === request.taskIds[0]);
  return request.status === 'awaiting_user_acceptance' && !request.receipt && writer?.status === 'completed' && writer.acceptanceSource === 'user' && writer.acceptedAttemptId === writer.attempts.at(-1)?.id;
}
export function acceptedRequestDigest(state, request) {
  if (!isAcceptedRequest(state, request)) throw new Error('수락한 요청 근거가 없습니다.');
  return reviewScopeDigest(request.receipt ?? { request, tasks: request.taskIds.map(id => state.tasks.find(task => task.id === id)), reviewEvidence: state.teamMode?.reviewEvidence.filter(e => e.requestId === request.id) ?? [] });
}

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
  if (check.source !== undefined && !['user', 'team_coordinator'].includes(check.source)) throw new Error('잘못된 검증 출처입니다.');
  if (check.exitCode !== null && !Number.isInteger(check.exitCode)) throw new Error('잘못된 검증 종료 코드입니다.');
  if (check.status === 'running' ? check.endedAt !== undefined || check.exitCode !== null : !validDate(check.endedAt)) throw new Error('검증 종료 state가 일치하지 않습니다.');
  if (check.status === 'passed' && check.exitCode !== 0) throw new Error('통과 검증의 종료 코드가 0이 아닙니다.');
  if (check.status === 'failed' && check.exitCode === 0) throw new Error('실패 검증의 종료 코드가 0입니다.');
  seen.add(check.id);
}
export function validateObservation(observation, attempts) {
  if (!observation || !validDate(observation.at) || !attempts.some(a => a?.id === observation.attemptId) || !['before', 'after'].includes(observation.phase) || !['available', 'unavailable', 'truncated'].includes(observation.status) || typeof observation.gitStatus !== 'string' || Buffer.byteLength(observation.gitStatus) > 32768 || typeof observation.diffSummary !== 'string' || Buffer.byteLength(observation.diffSummary) > 32768 || (observation.error !== undefined && (typeof observation.error !== 'string' || Buffer.byteLength(observation.error) > 4096))) throw new Error('손상된 handoff 관찰 state입니다.');
}
function validateTeamMode(mode, state, attemptIds) {
  const fail = () => { throw new Error('손상된 팀 모드 state입니다.'); };
  const exact = (obj, allowed) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => allowed.includes(k));
  const bounded = (s, limit) => typeof s === 'string' && !!s.trim() && Buffer.byteLength(s) <= limit;
  const natural = n => Number.isSafeInteger(n) && n >= 0;
  if (!exact(mode, ['version', 'enabled', 'generation', 'requests', 'coordinatorAttempts', 'events', 'reviewEvidence', 'journal', 'offers', 'latestHumanRequestId', 'pendingNativeRequestId']) || mode.version !== 1 || typeof mode.enabled !== 'boolean' || !natural(mode.generation) || !['requests', 'coordinatorAttempts', 'events', 'reviewEvidence'].every(k => Array.isArray(mode[k]) && mode[k].length <= 10000)) fail();
  const requests = new Map();
  for (const r of mode.requests) {
    if (!exact(r, ['id', 'text', 'origin', 'sessionId', 'receivedAt', 'revision', 'status', 'taskIds', 'answer', 'reason', 'checks', 'checkpoint', 'streamingIntent', 'amendments', 'artifactDigest', 'fixInstruction', 'receipt', 'recheckOnly', 'stages', 'stageCursor', 'restartFromTaskId', 'rationale', 'parentRequestId', 'parentReceiptDigest', 'provenance', 'visibleJournalIds', 'branchAnchorId', 'reviewTargetId', 'reviewTargetRevision', 'reviewFingerprint', 'resolvedByRequestId', 'confirmationContextId', 'inputPersistence', 'nativeText']) || !validId(r.id) || requests.has(r.id) || !bounded(r.text, 16384) || !['interactive', 'rpc'].includes(r.origin) || !validId(r.sessionId) || !validDate(r.receivedAt) || !natural(r.revision) || r.revision < 1 || !['received', 'classifying', 'clarifying', 'queued', 'running', 'paused', 'blocked', 'answered', 'awaiting_user_acceptance', 'accepted', 'stopping', 'cancelled', 'failed'].includes(r.status) || !Array.isArray(r.taskIds) || r.taskIds.length > 32 || new Set(r.taskIds).size !== r.taskIds.length || r.taskIds.some(id => !state.tasks.some(t => t.id === id)) || (r.answer !== undefined && !bounded(r.answer, 16384)) || (r.reason !== undefined && !bounded(r.reason, 16384))) fail();
    if (r.streamingIntent !== undefined && !['steer', 'followUp'].includes(r.streamingIntent)) fail();
    if ((r.checks !== undefined && (!Array.isArray(r.checks) || r.checks.length > 16 || r.checks.some(c => !bounded(c, 16384)) || new Set(r.checks).size !== r.checks.length)) || (r.checkpoint !== undefined && !['implementation', 'checks', 'review', 'fix', 'revalidate'].includes(r.checkpoint))) fail();
    if ((r.artifactDigest !== undefined && !/^[a-f0-9]{64}$/.test(r.artifactDigest)) || (r.fixInstruction !== undefined && !bounded(r.fixInstruction, 16384)) || (r.recheckOnly !== undefined && typeof r.recheckOnly !== 'boolean')) fail();
    if (r.amendments !== undefined && (!Array.isArray(r.amendments) || r.amendments.length > 256 || r.amendments.some(a => !exact(a, ['requestId', 'instruction', 'timing', 'status', 'previousChecks', 'checks', 'checksReason']) || !validId(a.requestId) || !bounded(a.instruction, 16384) || !['after_current', 'interrupt_then_resume'].includes(a.timing) || !['pending', 'applied'].includes(a.status)))) fail();
    for (const amendment of r.amendments ?? []) if (amendment.checks !== undefined || amendment.previousChecks !== undefined || amendment.checksReason !== undefined) {
      if (!bounded(amendment.checksReason, 4096) || ![amendment.previousChecks, amendment.checks].every(list => Array.isArray(list) && list.length <= 16 && new Set(list).size === list.length && list.every(command => bounded(command, 16384)))) fail();
    }
    if (r.stages !== undefined) {
      if (!Array.isArray(r.stages) || r.stages.length < 1 || r.stages.length > 8 || new Set(r.stages).size !== r.stages.length || r.stages.some(id => !r.taskIds.includes(id)) || !bounded(r.rationale, 4096) || !natural(r.stageCursor) || r.stageCursor > r.stages.length || (r.restartFromTaskId !== undefined && (!r.stages.includes(r.restartFromTaskId) || state.tasks.find(t => t.id === r.restartFromTaskId)?.role === 'reviewer'))) fail();
      const writers = r.stages.map(id => state.tasks.find(t => t.id === id)).filter(t => t.role !== 'reviewer');
      if (writers.length && (r.taskIds[0] !== writers.at(-1).id || state.tasks.find(t => t.id === r.taskIds[1])?.role !== 'reviewer' || r.stages.includes(r.taskIds[1]) || JSON.stringify(r.taskIds) !== JSON.stringify([writers.at(-1).id, r.taskIds[1], ...r.stages.filter(id => id !== writers.at(-1).id)]))) fail();
      if (!writers.length && JSON.stringify(r.taskIds) !== JSON.stringify(r.stages)) fail();
    } else if (r.stageCursor !== undefined || r.restartFromTaskId !== undefined || r.rationale !== undefined) fail();
    if ((r.visibleJournalIds !== undefined && (!Array.isArray(r.visibleJournalIds) || r.visibleJournalIds.length > 10000 || r.visibleJournalIds.some(id => !validId(id)) || new Set(r.visibleJournalIds).size !== r.visibleJournalIds.length)) || (r.branchAnchorId !== undefined && !validId(r.branchAnchorId)) || (r.confirmationContextId !== undefined && !validId(r.confirmationContextId))) fail();
    if ((r.inputPersistence !== undefined && !['native', 'custom'].includes(r.inputPersistence)) || (r.nativeText !== undefined && (r.inputPersistence !== 'native' || !bounded(r.nativeText, 64 * 1024 * 1024)))) fail();
    if (r.provenance === 'review' && (!validId(r.reviewTargetId) || !natural(r.reviewTargetRevision) || r.reviewTargetRevision < 1)) fail();
    if (r.provenance !== 'review' && (r.reviewTargetId !== undefined || r.reviewTargetRevision !== undefined)) fail();
    if (r.reviewFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(r.reviewFingerprint)) fail();
    if (r.provenance !== undefined && !['human', 'review'].includes(r.provenance)) fail();
    if (r.parentRequestId !== undefined && (!validId(r.parentRequestId) || !/^[a-f0-9]{64}$/.test(r.parentReceiptDigest))) fail();
    requests.set(r.id, r);
  }
  for (const r of mode.requests) {
    if (r.amendments?.some(a => !requests.has(a.requestId) || a.requestId === r.id)) fail();
    if (r.resolvedByRequestId !== undefined && (!requests.has(r.resolvedByRequestId) || r.resolvedByRequestId === r.id || requests.get(r.resolvedByRequestId).sessionId !== r.sessionId || r.status !== 'answered')) fail();
    if (r.reviewTargetId !== undefined && (!requests.has(r.reviewTargetId) || r.reviewTargetId === r.id || r.reviewTargetRevision > requests.get(r.reviewTargetId).revision)) fail();
    if (r.parentRequestId !== undefined) { const parent = requests.get(r.parentRequestId); if (!parent || !isAcceptedRequest(state, parent) || parent.id === r.id || acceptedRequestDigest(state, parent) !== r.parentReceiptDigest) fail(); }
  }
  if (mode.latestHumanRequestId !== undefined && (!requests.has(mode.latestHumanRequestId) || requests.get(mode.latestHumanRequestId).provenance === 'review')) fail();
  if (mode.pendingNativeRequestId !== undefined && (!requests.has(mode.pendingNativeRequestId) || requests.get(mode.pendingNativeRequestId).inputPersistence !== 'native')) fail();
  const journalIds = new Set();
  if (mode.journal !== undefined) {
    if (!Array.isArray(mode.journal) || mode.journal.length > 10000) fail();
    for (const entry of mode.journal) {
      const request = requests.get(entry?.requestId);
      if (!exact(entry, ['id', 'requestId', 'requestRevision', 'sessionId', 'role', 'kind', 'text', 'at', 'delivery', 'submittedAt', 'historyEntryId']) || !validId(entry.id) || journalIds.has(entry.id) || !request || entry.sessionId !== request.sessionId || !natural(entry.requestRevision) || entry.requestRevision < 1 || entry.requestRevision > request.revision || !['user', 'assistant'].includes(entry.role) || !['input', 'progress', 'answer', 'clarification', 'result', 'review', 'control'].includes(entry.kind) || !bounded(entry.text, 65536) || !validDate(entry.at) || !['pending', 'uncertain', 'delivered'].includes(entry.delivery) || (entry.submittedAt !== undefined && !validDate(entry.submittedAt)) || (entry.historyEntryId !== undefined && !validId(entry.historyEntryId)) || (entry.delivery === 'delivered' && !entry.historyEntryId)) fail();
      journalIds.add(entry.id);
    }
  }
  if (mode.offers !== undefined) {
    if (!Array.isArray(mode.offers) || mode.offers.length > 10000) fail(); const offerIds = new Set();
    for (const offer of mode.offers) {
      const request = requests.get(offer?.requestId), evidence = mode.reviewEvidence.find(e => e.id === offer?.evidenceId), journal = mode.journal?.find(e => e.id === offer?.journalId);
      if (!exact(offer, ['id','requestId','requestRevision','sessionId','evidenceId','artifactDigest','scopeDigest','stageAttempts','journalId']) || !validId(offer.id) || offerIds.has(offer.id) || !request || request.sessionId !== offer.sessionId || !natural(offer.requestRevision) || offer.requestRevision > request.revision || !evidence || evidence.requestId !== request.id || evidence.requestRevision !== offer.requestRevision || evidence.verdict !== 'pass' || offer.artifactDigest !== evidence.artifactDigest || offer.scopeDigest !== evidence.scopeDigest || !journalIds.has(offer.journalId) || journal?.requestId !== request.id || journal?.requestRevision !== offer.requestRevision || journal?.role !== 'assistant' || journal?.kind !== 'result' || !Array.isArray(offer.stageAttempts) || !offer.stageAttempts.length || offer.stageAttempts.some(a => !exact(a,['taskId','attemptId']) || !request.taskIds.includes(a.taskId) || !state.tasks.find(t => t.id === a.taskId && t.role !== 'reviewer')?.attempts.some(x => x.id === a.attemptId))) fail();
      offerIds.add(offer.id);
    }
  }
  for (const a of mode.coordinatorAttempts) {
    if (!exact(a, ['id', 'sessionId', 'profile', 'startedAt', 'endedAt', 'outcome', 'effectiveModels', 'text', 'error', 'usage', 'logFile', 'workerPid', 'recoveryPending', 'requestId', 'generation', 'requestRevision', 'repairOfAttemptId', 'protocolError']) || !requests.has(a.requestId) || !natural(a.generation) || a.generation > mode.generation || !natural(a.requestRevision) || a.requestRevision < 1 || a.requestRevision > requests.get(a.requestId).revision) fail();
    if (a.protocolError !== undefined && !bounded(a.protocolError, 4096)) fail();
    if (a.repairOfAttemptId !== undefined && !mode.coordinatorAttempts.some(prior => prior.id === a.repairOfAttemptId && prior.id !== a.id && prior.requestId === a.requestId && prior.generation === a.generation && prior.requestRevision === a.requestRevision && prior.endedAt && prior.outcome === 'success' && prior.protocolError && !prior.repairOfAttemptId)) fail();
    validateAttempt(a, attemptIds);
  }
  const eventIds = new Set();
  for (const e of mode.events) {
    if (!exact(e, ['id', 'requestId', 'kind', 'at']) || !validId(e.id) || eventIds.has(e.id) || !requests.has(e.requestId) || !['received', 'applied', 'uncertain'].includes(e.kind) || !validDate(e.at)) fail();
    eventIds.add(e.id);
  }
  const reviewIds = new Set();
  for (const e of mode.reviewEvidence) {
    const req = requests.get(e?.requestId), impl = state.tasks.find(t => t.id === e?.implementationTaskId), reviewer = state.tasks.find(t => t.id === e?.reviewerTaskId);
    if (!exact(e, ['id', 'requestId', 'implementationTaskId', 'implementationAttemptId', 'reviewerTaskId', 'reviewerAttemptId', 'artifactDigest', 'verdict', 'checkIds', 'requestRevision', 'scope', 'scopeDigest']) || !validId(e.id) || reviewIds.has(e.id) || !req || !req.taskIds.includes(impl?.id) || !req.taskIds.includes(reviewer?.id) || impl?.role === 'reviewer' || reviewer?.role !== 'reviewer' || !impl?.attempts.some(a => a.id === e.implementationAttemptId) || !reviewer?.attempts.some(a => a.id === e.reviewerAttemptId) || !/^[a-f0-9]{64}$/.test(e.artifactDigest) || !['pass', 'changes_required', 'blocked'].includes(e.verdict) || !Array.isArray(e.checkIds) || new Set(e.checkIds).size !== e.checkIds.length || e.checkIds.some(id => !impl.checks.some(c => c.id === id && c.attemptId === e.implementationAttemptId))) fail();
    if (e.scope !== undefined || e.scopeDigest !== undefined || e.requestRevision !== undefined) {
      const scope = e.scope, actual = reviewScope(req, impl, e.checkIds, state.tasks);
      if (!natural(e.requestRevision) || e.requestRevision < 1 || e.requestRevision > req.revision || !exact(scope, ['requestText', 'amendments', 'writer', 'reviewer', 'checks', 'stages']) || scope.requestText !== req.text || !exact(scope.writer, ['id', 'title', 'description', 'acceptance']) || JSON.stringify(scope.writer) !== JSON.stringify(actual.writer) || !Array.isArray(scope.amendments) || scope.amendments.length > 256 || scope.amendments.some(a => !exact(a, ['requestId', 'instruction', 'checks']) || !actual.amendments.some(x => JSON.stringify(x) === JSON.stringify(a))) || new Set(scope.amendments.map(a => a.requestId)).size !== scope.amendments.length || JSON.stringify(scope.checks) !== JSON.stringify(actual.checks) || !/^[a-f0-9]{64}$/.test(e.scopeDigest) || reviewScopeDigest(scope) !== e.scopeDigest || (e.requestRevision === req.revision && !req.stages && reviewScopeDigest(actual) !== e.scopeDigest)) fail();
    }
    if (req.stages) {
      const spec = e.scope?.reviewer;
      if (reviewer.id !== req.taskIds[1] || !exact(spec, ['id', 'title', 'description', 'acceptance']) || spec.id !== reviewer.id || spec.title !== reviewer.title || spec.description !== reviewer.description || JSON.stringify(spec.acceptance) !== JSON.stringify(reviewer.acceptance)) fail();
      const stages = e.scope?.stages;
      if (!Array.isArray(stages) || stages.length !== req.stages.length || stages.some((stage, i) => { const task = state.tasks.find(t => t.id === req.stages[i]); const attempt = task?.attempts.find(a => a.id === stage.attemptId); return !exact(stage, ['taskId','attemptId','role','title','description','acceptance','result']) || stage.taskId !== task?.id || stage.role !== task.role || stage.title !== task.title || stage.description !== task.description || JSON.stringify(stage.acceptance) !== JSON.stringify(task.acceptance) || !attempt || attempt.outcome !== 'success' || stage.result !== attempt.text; })) fail();
    } else if (e.scope?.stages !== undefined || e.scope?.reviewer !== undefined) fail();
    if (e.verdict === 'pass' && (impl.attempts.find(a => a.id === e.implementationAttemptId)?.outcome !== 'success' || reviewer.attempts.find(a => a.id === e.reviewerAttemptId)?.outcome !== 'success' || e.checkIds.some(id => impl.checks.find(c => c.id === id)?.status !== 'passed'))) fail();
    reviewIds.add(e.id);
  }
  for (const r of mode.requests) {
    if ((r.status === 'accepted') !== (r.receipt !== undefined)) fail();
    if (!r.receipt) continue;
    const receipt = r.receipt, evidence = mode.reviewEvidence.find(e => e.id === receipt.reviewEvidenceId), writer = state.tasks.find(t => t.id === r.taskIds[0]);
    if (!exact(receipt, ['acceptedAt', 'requestRevision', 'implementationTaskId', 'implementationAttemptId', 'reviewerTaskId', 'reviewerAttemptId', 'reviewEvidenceId', 'checkIds', 'artifactDigest', 'scopeDigest', 'stageAttempts']) || !validDate(receipt.acceptedAt) || receipt.requestRevision !== r.revision || !evidence || evidence.requestId !== r.id || evidence.verdict !== 'pass' || evidence.requestRevision !== r.revision || receipt.implementationTaskId !== r.taskIds[0] || receipt.reviewerTaskId !== r.taskIds[1] || receipt.implementationTaskId !== evidence.implementationTaskId || receipt.implementationAttemptId !== evidence.implementationAttemptId || receipt.reviewerTaskId !== evidence.reviewerTaskId || receipt.reviewerAttemptId !== evidence.reviewerAttemptId || receipt.artifactDigest !== evidence.artifactDigest || receipt.scopeDigest !== evidence.scopeDigest || JSON.stringify(receipt.checkIds) !== JSON.stringify(evidence.checkIds) || writer?.status !== 'completed' || writer.acceptanceSource !== 'user' || writer.acceptedAt !== receipt.acceptedAt || writer.acceptedAttemptId !== receipt.implementationAttemptId) fail();
    if (r.stages) {
      const writers = r.stages.map(id => state.tasks.find(t => t.id === id)).filter(t => t.role !== 'reviewer');
      if (!Array.isArray(receipt.stageAttempts) || JSON.stringify(receipt.stageAttempts) !== JSON.stringify(evidence.scope?.stages?.filter(stage => stage.role !== 'reviewer').map(stage => ({taskId:stage.taskId,attemptId:stage.attemptId}))) || JSON.stringify(receipt.stageAttempts) !== JSON.stringify(writers.map(t => ({taskId:t.id,attemptId:t.attempts.at(-1)?.id}))) || writers.some(t => t.status !== 'completed' || t.acceptanceSource !== 'user' || t.acceptedAt !== receipt.acceptedAt || t.acceptedAttemptId !== t.attempts.at(-1)?.id)) fail();
    } else if (receipt.stageAttempts !== undefined) fail();
  }
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
  if (state.teamMode !== undefined) validateTeamMode(state.teamMode, state, attemptIds);
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
