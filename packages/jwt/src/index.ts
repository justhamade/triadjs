/**
 * @triadjs/jwt — JWT verification for Triad endpoints.
 *
 * Public surface is intentionally tiny: one factory and the option /
 * claim types. See the README for integration recipes with Auth0,
 * Clerk, WorkOS, Firebase, Supabase, and NextAuth.
 */

export { requireJWT } from './require-jwt.js';
export type {
  StandardJwtClaims,
  RequireJwtOptions,
  RequireJwtResponses,
} from './types.js';
