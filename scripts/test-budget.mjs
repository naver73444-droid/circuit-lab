/** Run the Node unit tests with a small stdout summary; raw TAP stays on disk.
 * This does NOT mask failures: the exit code is the test runner's.
 * Usage: node scripts/test-budget.mjs [engine|ui-model|all] [--out <directory>]
 * (the browser smoke is separate: npm run test:browser)
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const groups = { engine: ['tests/engine'], 'ui-model': ['tests/ui-model'], all: ['tests/engine', 'tests/ui-model', 'tests/tooling'] };
const profile = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
if (!groups[profile]) { console.error(`Profile must be one of: ${Object.keys(groups).join(', ')}.`); process.exit(2); }
const remaining = process.argv.slice(process.argv[2] && !process.argv[2].startsWith('--') ? 3 : 2);
if (remaining.length && (remaining[0] !== '--out' || remaining.length !== 2)) { console.error('Use --out <directory>.'); process.exit(2); }
const out = resolve(root, remaining[1] || `.verification/${new Date().toISOString().replace(/[:.]/g, '-')}-${profile}`);
await mkdir(out, { recursive: true });

async function testFiles(directory) {
  const found = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await testFiles(path));
    else if (entry.name.endsWith('.test.mjs')) found.push(path.split(sep).join('/'));
  }
  return found;
}
const files = (await Promise.all(groups[profile].map(testFiles))).flat().sort();
if (!files.length) { console.error('No tests match this profile.'); process.exit(2); }
const args = ['--test', '--test-reporter=tap', ...files];
const sourceFiles = ['index.html', 'styles.css', 'server.mjs', 'package.json',
  ...(await readdir(resolve(root, 'src'))).filter((f) => f.endsWith('.js')).sort().map((f) => `src/${f}`), ...files, 'scripts/test-budget.mjs'];
const digest = createHash('sha256');
for (const path of sourceFiles) { digest.update(path + '\0'); digest.update(await readFile(resolve(root, path))); digest.update('\0'); }
const summary = { profile, node: process.version, platform: process.platform, arch: process.arch,
  startedAt: new Date().toISOString(), sourceAndTestsSha256: digest.digest('hex'),
  command: [process.execPath, ...args], files, counts: {}, failures: [], rawTap: relative(root, resolve(out, 'raw.tap')), stderr: relative(root, resolve(out, 'stderr.txt')) };
const raw = createWriteStream(resolve(out, 'raw.tap'));
const err = createWriteStream(resolve(out, 'stderr.txt'));
const run = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let lineBuffer = '';
function line(value) {
  const count = value.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+([\d.]+)/);
  if (count) summary.counts[count[1]] = Number(count[2]);
  const failure = value.match(/^\s*not ok \d+ - (.*)/);
  if (failure) summary.failures.push(failure[1].slice(0, 250));
}
run.stdout.on('data', (chunk) => {
  if (!raw.write(chunk)) { run.stdout.pause(); raw.once('drain', () => run.stdout.resume()); }
  lineBuffer += chunk.toString('utf8');
  let i; while ((i = lineBuffer.indexOf('\n')) >= 0) { line(lineBuffer.slice(0, i)); lineBuffer = lineBuffer.slice(i + 1); }
  // A huge failure diagnostic still goes to raw.tap, not into the summary parser.
  if (lineBuffer.length > 65536) lineBuffer = lineBuffer.slice(-1024);
});
run.stderr.on('data', (chunk) => { if (!err.write(chunk)) { run.stderr.pause(); err.once('drain', () => run.stderr.resume()); } });
run.on('error', (error) => { summary.runnerError = error.message; });
const result = await new Promise((res) => run.on('close', (code, signal) => res({ code, signal })));
line(lineBuffer);
await Promise.all([new Promise((res) => raw.end(res)), new Promise((res) => err.end(res))]);
summary.exitCode = result.code ?? 1; summary.signal = result.signal; summary.finishedAt = new Date().toISOString();
await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ profile: summary.profile, counts: summary.counts, exitCode: summary.exitCode,
  failures: summary.failures, sourceAndTestsSha256: summary.sourceAndTestsSha256,
  report: relative(root, resolve(out, 'summary.json')), rawTap: summary.rawTap }, null, 2));
process.exitCode = summary.exitCode;
