const dotenv = require('dotenv');
const path = require('path');

const envConfig = dotenv.config({ path: path.join(__dirname, '.env') });
const envVars = { ...envConfig.parsed, NODE_ENV: 'production' };

module.exports = {
  apps: [
    {
      name: 'tinyhands-listener',
      script: 'dist/index.js',
      env: { ...envVars, PROCESS_TYPE: 'listener' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'tinyhands-worker-1',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '1', PROCESS_TYPE: 'worker' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'tinyhands-worker-2',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '2', PROCESS_TYPE: 'worker' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'tinyhands-worker-3',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '3', PROCESS_TYPE: 'worker' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'tinyhands-sync',
      script: 'dist/sync.js',
      env: { ...envVars, PROCESS_TYPE: 'sync' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'tinyhands-scheduler',
      script: 'dist/scheduler.js',
      env: { ...envVars, PROCESS_TYPE: 'scheduler' },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
  ],
};
