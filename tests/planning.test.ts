import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlan } from "../src/core/planning.ts";
import { defaultProfiles, validateProfile } from "../src/core/profiles.ts";

const first = { id: "scan", title: "파일 탐색", description: "선택한 폴더를 읽는다.", role: "developer", dependsOn: [], acceptance: ["읽지 못하는 파일을 표시한다."] };

test("planner accepts strict JSON and one JSON fence", () => {
  const json = JSON.stringify({ tasks: [first, { ...first, id: "view", role: "designer", dependsOn: ["scan"] }] });
  assert.equal(parsePlan(json)[1].role, "designer");
  assert.equal(parsePlan("```json\n" + json + "\n```").length, 2);
});

test("planner rejects cycles, missing dependencies, duplicate ids and policy injection", () => {
  for (const tasks of [
    [{ ...first, dependsOn: ["missing"] }],
    [first, first],
    [{ ...first, dependsOn: ["view"] }, { ...first, id: "view", dependsOn: ["scan"] }],
    [{ ...first, role: "admin" }],
    [{ ...first, model: "gpt-6-astra", approval: true }],
    [{ ...first, acceptance: [] }],
  ]) assert.throws(() => parsePlan(JSON.stringify({ tasks })));
});

test("planner preserves Unicode, rejects over-size/unstructured/empty plans", () => {
  assert.equal(parsePlan(JSON.stringify({ tasks: [first] }))[0].title, "파일 탐색");
  assert.throws(() => parsePlan('{"tasks":[]}'));
  assert.throws(() => parsePlan("A plan: " + JSON.stringify({ tasks: [first] })));
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ ...first, description: "가".repeat(17000) }] })));
  assert.throws(() => parsePlan(JSON.stringify({ tasks: Array.from({ length: 33 }, (_, i) => ({ ...first, id: `task${i}` })) })));
});

test("profiles are explicit, independent and never accept ultra as native effort", () => {
  const one = defaultProfiles();
  const two = defaultProfiles();
  one.developer.effort = "max";
  assert.equal(two.developer.effort, "high");
  assert.equal(two.designer.model, "gpt-6-astra");
  assert.throws(() => validateProfile({ provider: "openai", model: "gpt-6-astra", effort: "ultra" }));
  assert.equal(validateProfile({ provider: "openai", model: "gpt-6-astra", effort: "max" }).effort, "max");
});

test("new project role defaults honor explicit leader and worker preferences", () => {
 const profiles = defaultProfiles();
 assert.deepEqual(profiles.planner, { provider: "openai", model: "gpt-6-astra", effort: "high" });
 assert.deepEqual(profiles.designer, { provider: "openai", model: "gpt-6-astra", effort: "high" });
 assert.deepEqual(profiles.developer, { provider: "openai", model: "gpt-6.1-sol", effort: "high" });
 assert.deepEqual(profiles.reviewer, { provider: "openai", model: "gpt-6.1-sol", effort: "high" });
});
