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

test('failed offline fallback retains the original connection error', async () => {
  const network = new NetworkFailure('路线服务网络连接失败或超时。');
  await assert.rejects(onlineFirstWithOfflineFallback(
    async () => { throw network; },
    async () => { throw new Error('没有覆盖起终点的汽车离线路网'); },
    () => true,
  ), error => error.cause === network && error.message.includes('连接失败或超时') && error.message.includes('汽车离线路网'));
});

test('cancelling the offline fallback remains cancellation', async () => {
  const cancelled = new DOMException('cancelled', 'AbortError');
  await assert.rejects(onlineFirstWithOfflineFallback(
    async () => { throw new NetworkFailure('连接失败'); },
    async () => { throw cancelled; },
    () => true,
  ), error => error === cancelled);
});
