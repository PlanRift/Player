import { describe, expect, it } from 'bun:test';
import { md5 } from '../auth';
import { sign } from './sign';

describe('Last.fm MD5 & Signing (Phase E.2)', () => {
  it('computes MD5 hashes matching standard RFC 1321 test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('signs parameters alphabetically sorted without delimiters and appends secret', () => {
    const params = {
      method: 'auth.getSession',
      api_key: 'testkey123',
      token: 'mytoken456',
      format: 'json', // Should be excluded from signature
    };
    const secret = 'supersecret';

    const expectedSig = md5('api_keytestkey123methodauth.getSessiontokenmytoken456supersecret');

    const result = sign(params, secret);
    expect(result).toBe(expectedSig);
  });
});
