import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseIncomingPlace } from '../modules/incomingPlace/parser.ts';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/google-place-links.json', import.meta.url), 'utf8'));

test('Google Maps explicit coordinate formats parse to WGS84 named places', () => {
  for (const fixture of fixtures) {
    const result = parseIncomingPlace(fixture.input, fixture.sharedName);
    assert.equal(result.kind, 'place', fixture.input);
    if (result.kind !== 'place') continue;
    assert.equal(result.format, 'google-maps');
    assert.equal(result.inputDatum, 'WGS84');
    assert.equal(result.place.name, fixture.name);
    assert.deepEqual(result.place.coordinates, fixture.coordinates);
    assert.equal(result.place.coordinateSystem, 'WGS84');
  }
});

test('place path name wins, while a separate shared title can name coordinate-only links', () => {
  const pathNameWins = parseIncomingPlace('https://www.google.com/maps/place/Path+Name/data=!3d10!4d20', 'Share Title');
  assert.equal(pathNameWins.kind, 'place');
  if (pathNameWins.kind === 'place') assert.equal(pathNameWins.place.name, 'Path Name');

  const suppliedTitle = parseIncomingPlace('https://www.google.com/maps/search/?api=1&query=10,20', 'Shared Trailhead');
  assert.equal(suppliedTitle.kind, 'place');
  if (suppliedTitle.kind === 'place') assert.equal(suppliedTitle.place.name, 'Shared Trailhead');

  const precedingTitle = parseIncomingPlace('Quiet Meadow\nhttps://www.google.com/maps?q=10,20');
  assert.equal(precedingTitle.kind, 'place');
  if (precedingTitle.kind === 'place') assert.equal(precedingTitle.place.name, 'Quiet Meadow');

  const genericTitle = parseIncomingPlace('https://www.google.com/maps?q=10,20', 'Google Maps');
  assert.equal(genericTitle.kind, 'place');
  if (genericTitle.kind === 'place') assert.equal(genericTitle.place.name, 'Google 地点');
});

test('Google Maps rejects view centers, names, place IDs, and short links without expansion', () => {
  assert.equal(parseIncomingPlace('https://www.google.com/maps/@10,20,12z').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://www.google.com/maps?ll=10,20&center=11,21').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://www.google.com/maps/search/?api=1&query=Some+Place').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://www.google.com/maps/place/Some+Place/data=!1sChIJsynthetic').kind, 'unsupported');
  const short = parseIncomingPlace('https://maps.app.goo.gl/synthetic');
  assert.equal(short.kind, 'unsupported');
  if (short.kind === 'unsupported') assert.match(short.reason, /需先联网展开/);
});

test('Google Maps rejects unsafe hosts, URL credentials, ports, and non-HTTPS URLs', () => {
  for (const url of [
    'https://google.com.evil/maps?q=10,20',
    'https://www.google.com.evil/maps?q=10,20',
    'https://user@www.google.com/maps?q=10,20',
    'https://www.google.com:8443/maps?q=10,20',
    'http://www.google.com/maps?q=10,20',
    'https://www.google.co.uk/maps?q=10,20',
    'https://www.google.com/mapsfoo?q=10,20',
  ]) assert.equal(parseIncomingPlace(url).kind, 'unsupported', url);
});

test('Google Maps rejects invalid, out-of-range, duplicate, conflicting, and multiple place coordinates', () => {
  for (const url of [
    'https://www.google.com/maps?q=86,20',
    'https://www.google.com/maps?q=10,181',
    'https://www.google.com/maps?q=10,20&query=10,20',
    'https://www.google.com/maps/place/Synthetic/data=!3d10!4d20!3d11!4d21',
    'https://www.google.com/maps/place/Synthetic/data=!3d10!4d20!3m1!4b1!3d11!4d21',
    'https://www.google.com/maps/place/10,20/data=!3d11!4d21',
    'https://www.google.com/maps?q=10,20 https://www.google.com/maps?q=10,20',
  ]) assert.equal(parseIncomingPlace(url).kind, 'unsupported', url);
});

test('Google Maps does not exceed the shared 8192-character input limit', () => {
  const url = `https://www.google.com/maps?q=10,20&x=${'a'.repeat(8192)}`;
  assert.equal(parseIncomingPlace(url).kind, 'unsupported');
});

test('Google legacy map host and unencoded label parentheses retain the selected point', () => {
  const result = parseIncomingPlace('https://maps.google.com/?q=10,20(Synthetic+Gate)');
  assert.equal(result.kind, 'place');
  assert.equal(result.kind === 'place' && result.place.name, 'Synthetic Gate');
  assert.deepEqual(result.kind === 'place' && result.place.coordinates, [20, 10]);
  const encodedPath = parseIncomingPlace('https://www.google.com/maps/place/10%2C20', 'Encoded gate');
  assert.deepEqual(encodedPath.kind === 'place' && encodedPath.place.coordinates, [20, 10]);
});

test('Google camera, tracking, route, or separated data tokens cannot invent a selected place', () => {
  for (const input of [
    'https://www.google.com/maps/@10,20,12z?tracking=!3d11!4d21',
    'https://www.google.com/maps/place/A?tracking=!3d11!4d21',
    'https://www.google.com/maps/dir/A/B/data=!3d11!4d21',
    'https://www.google.com/maps?q=A&data=!3d11!4d21',
    'https://www.google.com/maps/place/A/data=!3d11!9x1!4d21',
    'https://www.google.com/maps/place/A/data=!3d11!4d21?data=!3d11!4d21',
    'http://example.com https://www.google.com/maps?q=10,20',
  ]) assert.equal(parseIncomingPlace(input).kind, 'unsupported', input);
});
