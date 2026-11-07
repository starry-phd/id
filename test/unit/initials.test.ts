import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { initialsOf } from '../../src/identity/initials';

describe('initials for members without a photo', () => {
  test('family name first letter and given name first letter', () => {
    assert.equal(initialsOf('王小明'), '王小');
    assert.equal(initialsOf('John Smith'), 'JS');
    assert.equal(initialsOf('mary jane watson'), 'MW');
    assert.equal(initialsOf('歐陽 小明'), '歐小');
    assert.equal(initialsOf('林'), '林');
    assert.equal(initialsOf('  '), '星');
    assert.equal(initialsOf(null), '星');
  });
});
