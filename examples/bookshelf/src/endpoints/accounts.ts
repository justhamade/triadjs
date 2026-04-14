/**
 * Accounts endpoints — register, login, and the authenticated `/me`
 * introspection route.
 *
 * `register` and `login` share almost no code on purpose — register
 * writes a new user, login reads and verifies an existing one.
 * Collapsing them behind a helper would force a misleading "login
 * creates the user if missing" mental model. Both mint a fresh bearer
 * token on success so the client protocol stays uniform: always
 * `{ user, token }`.
 *
 * Duplicate-email detection uses a pre-check via
 * `userRepo.existsByEmail`. The theoretically safer approach is to
 * lean on the UNIQUE constraint and catch the integrity error, but
 * better-sqlite3's `SQLITE_CONSTRAINT` surfaces without a convenient
 * discriminator and the race window in an in-process demo is
 * effectively zero. Noted as friction in the report.
 */

import { endpoint, scenario } from '@triadjs/core';
import {
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from '../schemas/user.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';
import { verifyPassword } from '../repositories/user.js';

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

export const register = endpoint({
  name: 'register',
  method: 'POST',
  path: '/auth/register',
  summary: 'Register a new Bookshelf account',
  description:
    'Creates a user, hashes the password, and returns the user plus a freshly issued bearer token. Include the token on subsequent requests as "Authorization: Bearer <token>".',
  tags: ['Accounts'],
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
    const token = ctx.services.tokenStore.issue(user.id);
    return ctx.respond[201]({ user, token });
  },
  behaviors: [
    scenario('New users can register with email, password, and name')
      .given('a valid registration payload')
      .body({
        email: 'alice@example.com',
        password: 'correct-horse',
        name: 'Alice',
      })
      .when('I POST /auth/register')
      .then('response status is 201')
      .and('response body matches AuthResult')
      .and('response body has user.email "alice@example.com"')
      .and('response body has user.name "Alice"'),

    scenario('Registering an email that already exists returns 409')
      .given('a user with email "alice@example.com" already exists')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({
        email: 'alice@example.com',
        password: 'another-password',
        name: 'Another Alice',
      })
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
    'Verifies the password against the stored hash and issues a fresh bearer token on success.',
  tags: ['Accounts'],
  request: { body: LoginInput },
  responses: {
    200: { schema: AuthResult, description: 'Login succeeded' },
    401: { schema: ApiError, description: 'Invalid email or password' },
  },
  handler: async (ctx) => {
    const found = await ctx.services.userRepo.findByEmailWithHash(
      ctx.body.email,
    );
    // Use the same error envelope for unknown-user and wrong-password —
    // leaking "user exists" is a classic enumeration hole.
    if (!found || !verifyPassword(ctx.body.password, found.passwordHash)) {
      return ctx.respond[401]({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    const { passwordHash: _omit, ...user } = found;
    const token = ctx.services.tokenStore.issue(user.id);
    return ctx.respond[200]({ user, token });
  },
  behaviors: [
    scenario('Valid credentials produce a token')
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
  tags: ['Accounts'],
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
        const token = services.tokenStore.issue(user.id);
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
  ],
});
