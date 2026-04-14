/**
 * Drizzle-backed `UserRepository`.
 *
 * The `password_hash` column never leaves this module through the
 * API-facing `rowToApi` mapper — the `User` type simply does not have
 * a `passwordHash` field, so the translation layer enforces the
 * storage/API split by construction.
 *
 * Password hashing is a SHA-256 pass with a static salt. **Do NOT
 * ship this to production.** Real apps must use a memory-hard KDF
 * (bcrypt, scrypt, argon2). SHA-256 ships with Node, so it keeps the
 * example dependency-free while the lesson is about Triad's auth
 * *flow*, not password storage.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Infer } from '@triadjs/core';
import type { InferRow, InferInsert } from '@triadjs/drizzle';

import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User as UserSchema } from '../schemas/user.js';

type User = Infer<typeof UserSchema>;
type UserRow = InferRow<typeof users>;
type UserInsert = InferInsert<typeof users>;

const STATIC_SALT = 'bookshelf-demo-salt';

export function hashPassword(password: string): string {
  return createHash('sha256').update(password + STATIC_SALT).digest('hex');
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  return hashPassword(plaintext) === hash;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

/** Internal shape — carries the password hash so login can verify it. */
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
