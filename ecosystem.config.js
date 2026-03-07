module.exports = {
  apps: [
    {
      name: 'tinyjobs-listener',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-1',
      script: 'dist/worker.js',
      env: {
        NODE_ENV: 'production',
        WORKER_ID: '1',
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-2',
      script: 'dist/worker.js',
      env: {
        NODE_ENV: 'production',
        WORKER_ID: '2',
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-worker-3',
      script: 'dist/worker.js',
      env: {
        NODE_ENV: 'production',
        WORKER_ID: '3',
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: 'tinyjobs-sync',
      script: 'dist/sync.js',
      env: {
        NODE_ENV: 'production',
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
  ],
};
