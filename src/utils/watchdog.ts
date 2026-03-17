import { Worker, isMainThread } from 'worker_threads';
import { logger } from './logger';

const HEARTBEAT_INTERVAL = 5000;  // main thread pings every 5s
const WATCHDOG_TIMEOUT = 60000;   // kill if no ping for 60s

export function startWatchdog(): void {
  if (!isMainThread) return;

  const worker = new Worker(`
    const { parentPort } = require('worker_threads');
    let lastPing = Date.now();

    parentPort.on('message', (msg) => {
      if (msg === 'ping') lastPing = Date.now();
    });

    setInterval(() => {
      const elapsed = Date.now() - lastPing;
      if (elapsed > ${WATCHDOG_TIMEOUT}) {
        parentPort.postMessage('hung');
      }
    }, 5000);
  `, { eval: true });

  worker.on('message', (msg) => {
    if (msg === 'hung') {
      logger.error('Watchdog: main thread event loop blocked for >60s, forcing restart');
      process.exit(1);
    }
  });

  worker.unref();

  // Send heartbeat pings from main thread
  setInterval(() => {
    worker.postMessage('ping');
  }, HEARTBEAT_INTERVAL).unref();
}
