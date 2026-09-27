import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NetworkFailure,
  onlineFirstWithOfflineFallback,
} from '../modules/navigation/provider.ts';

test('route planning tries the online provider before offline routing', async () => {
  const calls = [];
  const route = await onlineFirstWithOfflineFallback(
    async () => {
      calls.push('online');
      return 'online route';
    },
    async () => {
      calls.push('offline');
      return 'offline route';
    },
    () => true,
  );
  assert.equal(route, 'online route');
  assert.deepEqual(calls, ['online']);
});

test('network rejection falls back to the downloaded offline network', async () => {
  const calls = [];
  const route = await onlineFirstWithOfflineFallback(
    async () => {
      calls.push('online');
      throw new NetworkFailure('连接失败');
    },
    async () => {
      calls.push('offline');
      return 'offline route';
    },
    () => true,
  );
  assert.equal(route, 'offline route');
  assert.deepEqual(calls, ['online', 'offline']);
});

test('a valid route-service error is surfaced without an offline retry', async () => {
  const calls = [];
  const serviceError = new Error('附近道路无法连通');
  await assert.rejects(
    onlineFirstWithOfflineFallback(
      async () => {
        calls.push('online');
        throw serviceError;
      },
      async () => {
        calls.push('offline');
        return 'offline route';
      },
      () => true,
    ),
    (error) => error === serviceError,
  );
  assert.deepEqual(calls, ['online']);
});

test('offline browser state skips the network request', async () => {
  const calls = [];
  const route = await onlineFirstWithOfflineFallback(
    async () => {
      calls.push('online');
      return 'online route';
    },
    async () => {
      calls.push('offline');
      return 'offline route';
    },
    () => false,
  );
  assert.equal(route, 'offline route');
  assert.deepEqual(calls, ['offline']);
});
