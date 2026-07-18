import assert from 'node:assert/strict';
import { DisconnectReason } from 'baileys';
import { classifyDisconnect } from './session.ts';

// Story 1.3 self-check: FR-15/AD-9 disconnect classification + backoff formula.
// Run: npx tsx src/check-reconnect-policy.ts

assert.deepEqual(classifyDisconnect(DisconnectReason.loggedOut, 0), { action: 'stop' });
assert.deepEqual(classifyDisconnect(DisconnectReason.badSession, 3), { action: 'clear_and_restart' });
assert.deepEqual(classifyDisconnect(DisconnectReason.restartRequired, 0), { action: 'restart' });

assert.deepEqual(classifyDisconnect(DisconnectReason.connectionLost, 0), {
  action: 'backoff',
  delayMs: 1_000,
});
assert.deepEqual(classifyDisconnect(DisconnectReason.timedOut, 3), {
  action: 'backoff',
  delayMs: 8_000,
});
assert.deepEqual(classifyDisconnect(DisconnectReason.connectionClosed, 4), {
  action: 'backoff',
  delayMs: 16_000,
});
assert.deepEqual(classifyDisconnect(undefined, 0), { action: 'backoff', delayMs: 1_000 });

assert.deepEqual(classifyDisconnect(DisconnectReason.connectionLost, 5), { action: 'give_up' });

console.log('check-reconnect-policy: ok');
