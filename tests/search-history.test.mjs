import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_HISTORY_KEY,
  clearSearchHistory,
  normalizeSearchHistoryEntries,
  normalizeSearchHistoryQuery,
  parseSearchHistoryPayload,
  readSearchHistory,
  recordSearchHistoryEntry,
  removeSearchHistoryEntry,
  writeSearchHistory,
} from '../modules/navigation/searchHistory.ts';

class MemoryStorage {
  values = new Map();
  calls = [];
  getItem(key) { this.calls.push(['get', key]); return this.values.get(key) ?? null; }
  setItem(key, value) { this.calls.push(['set', key]); this.values.set(key, String(value)); }
  removeItem(key) { this.calls.push(['remove', key]); this.values.delete(key); }
}

test('normalizes whitespace, rejects one-character queries, and caps query length', () => {
  assert.equal(normalizeSearchHistoryQuery('  Central\t Park\nMuseum  '), 'Central Park Museum');
  assert.equal(normalizeSearchHistoryQuery(' x '), null);
  assert.equal(normalizeSearchHistoryQuery('   '), null);
  assert.equal(normalizeSearchHistoryQuery(`  ${'A'.repeat(130)}  `), 'A'.repeat(120));
});

test('deduplicates case-insensitively and keeps the latest spelling at the front', () => {
  const entries = normalizeSearchHistoryEntries(['River Park', 'museum', 'RIVER PARK']);
  assert.deepEqual(entries, ['River Park', 'museum']);
  assert.deepEqual(recordSearchHistoryEntry(entries, ' MUSEUM '), ['MUSEUM', 'River Park']);
});

test('keeps at most twelve entries with the newest first', () => {
  const values = Array.from({ length: 13 }, (_, index) => `Place ${index}`);
  const entries = recordSearchHistoryEntry(values.slice(1), values[0]);
  assert.equal(entries.length, 12);
  assert.equal(entries[0], 'Place 0');
  assert.equal(entries.at(-1), 'Place 11');
});

test('remove is case-insensitive and clear affects only the history key', () => {
  const storage = new MemoryStorage();
  storage.values.set('shantu.saved-routes.v1', 'keep');
  assert.deepEqual(removeSearchHistoryEntry(['One Place', 'Other Place'], 'one place'), ['Other Place']);
  assert.deepEqual(removeSearchHistoryEntry(['One Place'], 'x'), ['One Place']);

  assert.equal(writeSearchHistory(['One Place'], storage), true);
  assert.equal(clearSearchHistory(storage), true);
  assert.equal(storage.values.has(SEARCH_HISTORY_KEY), false);
  assert.equal(storage.values.get('shantu.saved-routes.v1'), 'keep');
  assert.ok(storage.calls.every(([, key]) => key === SEARCH_HISTORY_KEY));
});

test('writes only the version and query strings under the dedicated key', () => {
  const storage = new MemoryStorage();
  assert.equal(writeSearchHistory([' Home  Park ', 'home park', 'Museum'], storage), true);
  const payload = JSON.parse(storage.values.get(SEARCH_HISTORY_KEY));
  assert.deepEqual(payload, { version: 1, entries: ['Home Park', 'Museum'] });
});

test('invalid JSON, unsupported versions, and unexpected fields degrade to empty without rewriting', () => {
  for (const raw of [
    '{bad json',
    JSON.stringify({ version: 2, entries: ['Old Place'] }),
    JSON.stringify({ version: 1, entries: ['Place'], coordinates: [[1, 2]] }),
    JSON.stringify({ version: 1, entries: 'not-an-array' }),
  ]) {
    assert.deepEqual(parseSearchHistoryPayload(raw), []);
  }
  const storage = new MemoryStorage();
  storage.values.set(SEARCH_HISTORY_KEY, '{bad json');
  assert.deepEqual(readSearchHistory(storage), []);
  assert.deepEqual(storage.calls, [['get', SEARCH_HISTORY_KEY]]);
  assert.equal(storage.values.get(SEARCH_HISTORY_KEY), '{bad json');
});

test('unavailable or throwing storage safely falls back without touching other keys', () => {
  const unavailable = null;
  assert.deepEqual(readSearchHistory(unavailable), []);
  assert.equal(writeSearchHistory(['Place'], unavailable), false);
  assert.equal(clearSearchHistory(unavailable), false);

  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(readSearchHistory(throwing), []);
  assert.equal(writeSearchHistory(['Place'], throwing), false);
  assert.equal(clearSearchHistory(throwing), false);
});
