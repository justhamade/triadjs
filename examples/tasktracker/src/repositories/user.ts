/**
 * Drizzle-backed `UserRepository`.
 *
 * Handles the `users` table plus the password-hash column. Notice how
 * the hash never leaves this module through the `rowToApi` mapper —
 * the API-facing `User` type simply does not have a `passwordHash`
 * field, so the translation layer enforces the storage/API split by
 * construction.
 *
 * `verifyPassword` and `hashPassword` live in `../auth.ts` so this
 * repository stays focused on persistence. The split means password
 * hashing can be swapped (e.g. to bcrypt) without touching SQL.
 */

import { eq } from 'drizzle-orm';
import type { Infer } from '@triadjs/core';
import type { InferRow, InferInsert } from '@triadjs/drizzle';

import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User as UserSchema } from '../schemas/user.js';
import { hashPassword } from '../auth.js';

type User = Infer<typeof UserSchema>;
type UserRow = InferRow<typeof users>;
type UserInsert = InferInsert<typeof users>;

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

/**
 * Internal shape — used when the auth flow needs the password hash for
 * comparison. Never cross the API boundary.
 */
export interface UserWithHash extends User {
  passwordHash: string;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
    };
  }

  private rowToApiWithHash(row: UserRow): UserWithHash {
    return { ...this.rowToApi(row), passwordHash: row.passwordHash };
  }

  async create(input: CreateUserInput): Promise<User> {
    const row: UserInsert = {
      id: crypto.randomUUID(),
      email: input.email,
      passwordHash: hashPassword(input.password),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    // The UNIQUE constraint on users.email is the source of truth for
    // duplicates — the handler catches the integrity error and maps it
    // to a 409. We deliberately do NOT pre-check with a SELECT because
    // that introduces a race window under concurrent registration.
    this.db.insert(users).values(row).run();
    return this.rowToApi(row as UserRow);
  }

  async findById(id: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    const row = this.db.select().from(users).where(eq(users.email, email)).get();
    return row ? this.rowToApiWithHash(row) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const row = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();
    return row !== undefined;
  }

  async clear(): Promise<void> {
    this.db.delete(users).run();
  }
}
