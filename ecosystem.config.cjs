// AD-16: the worker runs under a process supervisor that auto-restarts it;
// safe resume across a restart is AD-15's startup reconciliation.
module.exports = {
  apps: [
    {
      name: 'wadl-worker',
      cwd: __dirname,
      script: 'npx',
      args: ['tsx', 'worker/src/index.ts'],
      autorestart: true,
      // max_restarts only caps *unstable* exits — ones that happen before
      // min_uptime elapses. Without an explicit min_uptime, pm2's 1s default
      // means a worker that fails after a second of runtime resets the
      // unstable counter and can restart forever.
      min_uptime: 10_000,
      max_restarts: 50,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 5000,
    },
  ],
};
