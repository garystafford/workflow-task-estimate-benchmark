import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowNames } from '../src/matrix/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [target, ...options] = process.argv.slice(2);
const validateOnly = options.length === 1 && options[0] === '--validate-only';

function runWorkflow(workflow) {
  const dir = join('results', workflow);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.benchmark-lock');
  let fd;
  try {
    fd = openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another run holds ${lock}. Check the recorded process before retrying.`);
    throw error;
  }
  try {
    writeFileSync(fd, String(process.pid));
    console.log(`Validating ${workflow} → ${dir}`);
    const runner = 'src/matrix/run.mjs';
    const io = { stdio: 'inherit' };
    execFileSync(process.execPath, [runner, 'validate', dir, workflow], io);
    if (validateOnly) return;

    console.log(`Running ${workflow}`);
    execFileSync(process.execPath, [runner, 'live', dir, workflow], io);
    console.log(`Grading ${workflow}`);
    execFileSync(process.execPath, [runner, 'grade', dir, workflow], {
      ...io,
      env: { ...process.env, PROMPTFOO_CACHE_ENABLED: 'false', PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_CONFIG_DIR: '.promptfoo' },
    });
    console.log(`Auditing ${workflow}`);
    execFileSync(process.execPath, ['scripts/verify-matrix-sessions.mjs', dir], io);
    execFileSync('python3', ['scripts/report-workflow-matrix.py', dir], io);
    console.log(`Report: ${dir}/README.md`);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

try {
  if ((!workflowNames.includes(target) && target !== 'all') || (options.length && !validateOnly)) {
    throw new Error(`Choose npm run <${[...workflowNames, 'all'].join('|')}> [-- --validate-only]`);
  }
  process.chdir(root);
  if (!validateOnly) {
    if (existsSync('.env')) process.loadEnvFile('.env');
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Set OPENAI_API_KEY in .env or your shell, or use --validate-only.');
  }
  for (const workflow of target === 'all' ? workflowNames : [target]) runWorkflow(workflow);
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
}
