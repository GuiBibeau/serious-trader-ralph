import { test, expect } from 'bun:test';
import { redact } from '../../src/util/redaction.js';

// Redaction should only mask secret-like keys.
test('redact masks secret keys but leaves normal fields', () => {
  const input = {
    apiKey: 'secret-value',
    token: 'another-secret',
    privateKey: 'pk',
    keep: 'hello',
    nested: {
      authorization: 'bearer xxx',
      normal: 'ok',
    },
    list: [{ secret: 'nope' }, { foo: 'bar' }],
  };

  const out = redact(input);
  expect(out.apiKey).toBe('***');
  expect(out.token).toBe('***');
  expect(out.privateKey).toBe('***');
  expect(out.keep).toBe('hello');
  expect((out as any).nested.authorization).toBe('***');
  expect((out as any).nested.normal).toBe('ok');
  expect((out as any).list[0].secret).toBe('***');
  expect((out as any).list[1].foo).toBe('bar');
});
