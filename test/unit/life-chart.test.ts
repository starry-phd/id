import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lifeChartOf } from '../../src/identity/profile';

test('life chart: 1986-06-30 is Cancer 4, birthday number 3, talent 33, total 6', () => {
  const c = lifeChartOf('1986-06-30');
  assert.equal(c.zodiac_name, '巨蟹座');
  assert.equal(c.zodiac_number, 4);
  assert.equal(c.birthday_number, 3);
  assert.deepEqual(c.talent_numbers, [33]);
  assert.equal(c.life_number, 6);
  assert.equal(c.rings[3]?.talent, 2, 'two green circles on 3');
  assert.equal(c.rings[3]?.black, 1);
  assert.equal(c.rings[3]?.birthday, true);
  assert.equal(c.rings[4]?.zodiac, true);
  assert.equal(c.rings[6]?.life, true);
  assert.equal(c.rings[6]?.black, 2, 'zero is never drawn, 6 appears twice in the birth date');
  assert.equal(c.rings[2]?.black, 0);
});

test('zodiac numbers above nine are added down to one digit', () => {
  assert.equal(lifeChartOf('1990-01-05').zodiac_number, 1);
  assert.equal(lifeChartOf('1990-03-01').zodiac_number, 3);
});
