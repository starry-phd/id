import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPLY_TEMPLATES } from '../../src/web/admin-tickets';

test('reply templates fit the 2000 character reply limit and have unique labels', () => {
  assert.ok(REPLY_TEMPLATES.length >= 3);
  assert.equal(new Set(REPLY_TEMPLATES.map((t) => t.label)).size, REPLY_TEMPLATES.length);
  for (const t of REPLY_TEMPLATES) assert.ok(t.text.length > 10 && t.text.length <= 2000, t.label);
});
