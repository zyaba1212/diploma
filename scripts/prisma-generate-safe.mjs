import { spawn } from 'node:child_process';

const env = { ...process.env };

delete env.PRISMA_GENERATE_NO_ENGINE;
delete env.PRISMA_CLIENT_ENGINE_TYPE;
delete env.PRISMA_GENERATE_DATAPROXY;

const args = ['prisma', 'generate', ...process.argv.slice(2)];

const child = spawn('npx', args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

