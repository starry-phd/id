// Random nicknames and the name every App shows.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NICKNAME_ADJECTIVES, NICKNAME_ANIMALS, NICKNAME_FLOWERS, NICKNAME_INSECTS, randomNickname } from '../../src/identity/nicknames';
import { shownName } from '../../src/identity/profile';

describe('random nicknames', () => {
  test('always a cheerful adjective plus an animal, insect or flower, within 30 characters, never the current one', () => {
    const names = [...NICKNAME_ANIMALS, ...NICKNAME_INSECTS, ...NICKNAME_FLOWERS];
    for (let i = 0; i < 300; i++) {
      const nick = randomNickname('陽光海豚');
      assert.ok(nick.length >= 3 && nick.length <= 30, nick);
      assert.notEqual(nick, '陽光海豚');
      assert.ok(NICKNAME_ADJECTIVES.some((a) => nick.startsWith(a)) && names.some((n) => nick.endsWith(n)), nick);
    }
    assert.equal(randomNickname(null, () => 0), `${NICKNAME_ADJECTIVES[0]}${NICKNAME_ANIMALS[0]}`);
  });
  test('the shown name is the nickname first, the real name second, nothing when both are empty', () => {
    assert.equal(shownName('小星星', '王小明'), '小星星');
    assert.equal(shownName('  ', '王小明'), '王小明');
    assert.equal(shownName(null, '王小明'), '王小明');
    assert.equal(shownName('', null), null);
  });
});
