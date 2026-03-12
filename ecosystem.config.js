const dotenv = require('dotenv');
const path = require('path');

const envConfig = dotenv.config({ path: path.join(__dirname, '.env') });
const envVars = { ...envConfig.parsed, NODE_ENV: 'production' };

module.exports = {
  apps: [
    {
      name: 'tinyjobs-listener',
      script: 'dist/index.js',
      env: envVars,
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-1',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '1' },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-2',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '2' },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-3',
      script: 'dist/worker.js',
      env: { ...envVars, WORKER_ID: '3' },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-sync',
      script: 'dist/sync.js',
      env: envVars,
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-scheduler',
      script: 'dist/scheduler.js',
      env: envVars,
      restart_delay: 1000,
      max_restarts: 10,
    },
  ],
};
