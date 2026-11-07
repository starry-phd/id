// The passkey button script is plain JavaScript inside a TypeScript template literal, where a stray backslash
// silently changes the code. Parsing it here catches that before a browser does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passkeyScript } from '../../src/web/account';

for (const mode of ['register', 'login', 'stepup'] as const) {
  test(`the ${mode} passkey script is valid JavaScript and encodes base64url without regex escapes`, () => {
    const out = String(passkeyScript({ get: () => 'nonce' } as never, mode, '/account?x=<y>'));
    const code = /<script[^>]*>([\s\S]*)<\/script>/.exec(out)?.[1] ?? '';
    assert.ok(code.length > 100);
    assert.doesNotThrow(() => new Function(code));
    assert.doesNotMatch(code, /replace\(\//, 'no regex replace: backslashes get lost in the template literal');
    assert.ok(!code.includes('<y>'), 'next URL is escaped');
  });
}
