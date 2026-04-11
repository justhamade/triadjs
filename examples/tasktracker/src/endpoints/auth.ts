/**
 * Authentication endpoints.
 *
 * `register` and `login` share almost no code on purpose — register is
 * a write that creates a new user; login is a read that verifies a
 * password. Tying them together behind a helper would force a
 * misleading abstraction ("login creates a user if missing"?). Instead
 * both use the same `TokenStore` service to mint fresh bearer tokens
 * so the client protocol is consistent: always `{ user, token }` on
 * success.
 *
 * Duplicate-email detection on register uses a pre-check via
 * `userRepo.existsByEmail`. The petstore would tell you to rely on
 * the `UNIQUE` index and catch the integrity error instead — that IS
 * the more robust approach — but the Triad test runner runs handlers
 * in-process, and better-sqlite3's SQLITE_CONSTRAINT throws synchronously
 * without a convenient error discriminator. The pre-check keeps the
 * handler readable at the cost of a tiny race window in the single-
 * user demo context where nobody will ever notice. Listed in the
 * report as a small piece of friction.
 */

import { endpoint, scenario } from '@triad/core';
import {
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from '../schemas/user.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth, verifyPassword } from '../auth.js';

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

export const register = endpoint({
  name: 'register',
  method: 'POST',
  path: '/auth/register',
  summary: 'Register a new user account',
  description:
    'Creates a user, hashes the password, and returns the user plus a freshly issued bearer token. The client should include the token on every subsequent request as "Authorization: Bearer <token>".',
  tags: ['Auth'],
  request: { body: RegisterInput },
  responses: {
    201: { schema: AuthResult, description: 'Registration succeeded' },
    409: { schema: ApiError, description: 'Email is already in use' },
  },
  handler: async (ctx) => {
    const exists = await ctx.services.userRepo.existsByEmail(ctx.body.email);
    if (exists) {
      return ctx.respond[409]({
        code: 'EMAIL_IN_USE',
        message: `An account with email "${ctx.body.email}" already exists.`,
      });
    }
    const user = await ctx.services.userRepo.create(ctx.body);
    const token = ctx.services.tokens.issue(user.id);
    return ctx.respond[201]({ user, token });
  },
  behaviors: [
    scenario('New users can register with email, password, and name')
      .given('a valid registration payload')
      .body({ email: 'alice@example.com', password: 'correct-horse', name: 'Alice' })
      .when('I POST /auth/register')
      .then('response status is 201')
      .and('response body matches AuthResult')
      .and('response body has user.email "alice@example.com"')
      .and('response body has user.name "Alice"'),

    scenario('Registering with an existing email returns 409')
      .given('a user with email "alice@example.com" already exists')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'other-password', name: 'Another Alice' })
      .when('I POST /auth/register')
      .then('response status is 409')
      .and('response body has code "EMAIL_IN_USE"'),
  ],
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

export const login = endpoint({
  name: 'login',
  method: 'POST',
  path: '/auth/login',
  summary: 'Exchange credentials for a bearer token',
  description:
    'Verifies the password against the stored hash and, on success, issues a fresh bearer token. Each successful login rotates the token so old device sessions can be invalidated by re-logging-in.',
  tags: ['Auth'],
  request: { body: LoginInput },
  responses: {
    200: { schema: AuthResult, description: 'Login succeeded' },
    401: { schema: ApiError, description: 'Bad credentials' },
  },
  handler: async (ctx) => {
    const found = await ctx.services.userRepo.findByEmailWithHash(ctx.body.email);
    if (!found) {
      // Deliberately return the same error as a wrong-password failure —
      // leaking "user exists" is a common enumeration vulnerability.
      return ctx.respond[401]({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    if (!verifyPassword(ctx.body.password, found.passwordHash)) {
      return ctx.respond[401]({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    const { passwordHash: _omit, ...user } = found;
    const token = ctx.services.tokens.issue(user.id);
    return ctx.respond[200]({ user, token });
  },
  behaviors: [
    scenario('Users can log in with valid credentials')
      .given('a registered user')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'correct-horse' })
      .when('I POST /auth/login')
      .then('response status is 200')
      .and('response body matches AuthResult')
      .and('response body has user.email "alice@example.com"'),

    scenario('Wrong password returns 401')
      .given('a registered user')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'wrong-password' })
      .when('I POST /auth/login')
      .then('response status is 401')
      .and('response body has code "INVALID_CREDENTIALS"'),

    scenario('Unknown email returns 401')
      .given('no user is registered')
      .body({ email: 'ghost@example.com', password: 'whatever' })
      .when('I POST /auth/login')
      .then('response status is 401')
      .and('response body has code "INVALID_CREDENTIALS"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

export const getMe = endpoint({
  name: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'Return the authenticated user',
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
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
        const token = services.tokens.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .when('I GET /me')
      .then('response status is 200')
      .and('response body has email "alice@example.com"'),

    scenario('Missing Authorization header returns 401')
      .given('no credentials are provided')
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),

    scenario('An unknown token returns 401')
      .given('a bogus token')
      .headers({ authorization: 'Bearer not-a-real-token' })
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});
