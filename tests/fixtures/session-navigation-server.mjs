// Terminal fixture: node tests/fixtures/session-navigation-server.mjs
// A separate terminal starts the printed Pi command and releases the local response.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'codexteams-terminal-fixture-'));
const project = join(temp, 'project'), agent = join(temp, 'agent'), release = join(temp, 'release');
mkdirSync(project); mkdirSync(agent);
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  console.log(`Pending local request for ${payload.model}; release with: touch ${JSON.stringify(release)}`);
  const timer = setInterval(() => {
    if (!existsSync(release)) return;
    clearInterval(timer);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Local fixture completed.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
  }, 100);
  res.on('close', () => clearInterval(timer));
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { openai: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only', models: [{ id: 'gpt-6.1-sol', name: 'local fixture', reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  console.log(`Project: ${project}\nRun in another terminal:\ncd ${JSON.stringify(project)} && PI_CODING_AGENT_DIR=${JSON.stringify(agent)} ${JSON.stringify(resolve('node_modules/.bin/pi'))} --offline --no-extensions -e ${JSON.stringify(resolve('src/index.ts'))}\nThen: /teams add developer local fixture → /teams run task-1 → /teams sessions → select → Esc → release → observe completion.\nStop this fixture with Ctrl-C.`);
});
