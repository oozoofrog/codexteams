import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const capture = process.env.LAUNCHER_CAPTURE;
const mode = process.env.LAUNCHER_FIXTURE_MODE;
function record(value) { if (capture) appendFileSync(capture, `${JSON.stringify(value)}\n`); }
record({ args, cwd: process.cwd(), selected: process.env.CODEXTEAMS_PI, stdinTTY: !!process.stdin.isTTY, stdoutTTY: !!process.stdout.isTTY });
if (args[0] === '--version') {
  if (mode === 'hang-version') setInterval(() => {}, 1000);
  else if (mode === 'fail-version') { console.error('fixture version probe failed'); process.exitCode = 9; }
  else console.log(process.env.LAUNCHER_FIXTURE_VERSION ?? '1.4.0');
} else if (mode === 'wait-signal') {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
    record({ received: signal });
    process.exit(37);
  });
  console.log('fixture ready');
  setInterval(() => {}, 1000);
} else if (mode === 'self-signal') {
  process.kill(process.pid, 'SIGTERM');
} else if (mode === 'echo') {
  process.stdin.pipe(process.stdout);
} else {
  console.log('fixture stdout');
  console.error('fixture stderr');
  process.exitCode = Number(process.env.LAUNCHER_FIXTURE_EXIT ?? '0');
}
