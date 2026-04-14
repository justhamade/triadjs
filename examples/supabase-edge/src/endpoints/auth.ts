/**
 * Auth endpoints.
 *
 * Unlike `examples/tasktracker`, this example does NOT expose
 * register/login endpoints — Supabase Auth owns those flows, and
 * clients exchange credentials for a JWT against `/auth/v1/signup`
 * and `/auth/v1/token` on the Supabase project itself (or via
 * `supabase-js` on the client). Our API only sees users by way of
 * a valid JWT on an incoming request.
 *
 * That leaves exactly one endpoint in the Auth context: `GET /me`,
 * which decodes the caller's identity from `ctx.state.user` and
 * returns it verbatim. It's a useful smoke test: if `/me` returns
 * 200 with the right email, the entire auth pipeline — client JWT,
 * `Authorization` header, `requireAuth` beforeHandler, and
 * `authVerifier` service — is working end-to-end.
 */

import { endpoint, scenario } from '@triadjs/core';
import { User } from '../schemas/user.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../supabase-auth.js';

export const getMe = endpoint({
  name: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'Return the authenticated user',
  description:
    'Decodes the caller from the Supabase JWT on the Authorization header and returns the matching User. Useful as a health check for the full auth pipeline.',
  tags: ['Auth'],
  beforeHandler: requireAuth,
  responses: {
    200: { schema: User, description: 'The authenticated user' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    return ctx.respond[200](ctx.state.user);
  },
  behaviors: [
    scenario('A valid token resolves to the authenticated user')
      .given('a logged-in user')
      .setup(async (services) => {
        const user = {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'alice@example.com',
          name: 'Alice',
        };
        // Memory verifier — tests never talk to real Supabase Auth.
        // The cast is safe because `test-setup.ts` guarantees the
        // injected verifier is a `MemoryAuthVerifier`.
        const token = (
          services.authVerifier as import('../auth-verifier.js').MemoryAuthVerifier
        ).register(user);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .when('I GET /me')
      .then('response status is 200')
      .and('response body has email "alice@example.com"')
      .and('response body has name "Alice"'),

    scenario('Missing Authorization header returns 401')
      .given('no credentials are provided')
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),

    scenario('An unknown token returns 401')
      .given('a bogus token')
      .headers({ authorization: 'Bearer test-not-a-real-token' })
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});
