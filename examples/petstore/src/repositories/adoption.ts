/**
 * Drizzle-backed adoption and adopter repositories.
 *
 * `Adopter` is a simple 1:1 mapping between API and DB. `Adoption` uses
 * the same Money-as-two-columns pattern as `Pet.adoptionFee`, but with a
 * different pair of column names (`fee_amount`, `fee_currency`).
 */

import { and, eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';
import type { InferRow, InferInsert } from '@triad/drizzle';

import type { Db } from '../db/client.js';
import { adopters, adoptions } from '../db/schema.js';
import type {
  Adopter as AdopterSchema,
  Adoption as AdoptionSchema,
} from '../schemas/adoption.js';

type Adopter = Infer<typeof AdopterSchema>;
type Adoption = Infer<typeof AdoptionSchema>;

type AdopterRow = InferRow<typeof adopters>;
type AdopterInsert = InferInsert<typeof adopters>;

type AdoptionRow = InferRow<typeof adoptions>;
type AdoptionInsert = InferInsert<typeof adoptions>;

// ---------------------------------------------------------------------------
// Adopter
// ---------------------------------------------------------------------------

export class AdopterRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: AdopterRow): Adopter {
    return { id: row.id, name: row.name, email: row.email };
  }

  async create(input: { name: string; email: string }): Promise<Adopter> {
    const row: AdopterInsert = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
    };
    this.db.insert(adopters).values(row).run();
    return this.rowToApi(row as AdopterRow);
  }

  async findById(id: string): Promise<Adopter | null> {
    const row = this.db.select().from(adopters).where(eq(adopters.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async clear(): Promise<void> {
    this.db.delete(adopters).run();
  }
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

export interface RequestAdoptionInput {
  petId: string;
  adopterId: string;
  fee: Adoption['fee'];
}

export class AdoptionRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: AdoptionRow): Adoption {
    const adoption: Adoption = {
      id: row.id,
      petId: row.petId,
      adopterId: row.adopterId,
      status: row.status,
      fee: { amount: row.feeAmount, currency: row.feeCurrency },
      requestedAt: row.requestedAt,
    };
    if (row.completedAt !== null) {
      adoption.completedAt = row.completedAt;
    }
    return adoption;
  }

  async request(input: RequestAdoptionInput): Promise<Adoption> {
    const row: AdoptionInsert = {
      id: crypto.randomUUID(),
      petId: input.petId,
      adopterId: input.adopterId,
      status: 'requested',
      feeAmount: input.fee.amount,
      feeCurrency: input.fee.currency,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.db.insert(adoptions).values(row).run();
    return this.rowToApi(row as AdoptionRow);
  }

  async findById(id: string): Promise<Adoption | null> {
    const row = this.db
      .select()
      .from(adoptions)
      .where(eq(adoptions.id, id))
      .get();
    return row ? this.rowToApi(row) : null;
  }

  async findActiveByPetId(petId: string): Promise<Adoption | null> {
    const row = this.db
      .select()
      .from(adoptions)
      .where(and(eq(adoptions.petId, petId), eq(adoptions.status, 'requested')))
      .get();
    return row ? this.rowToApi(row) : null;
  }

  async complete(id: string): Promise<Adoption | null> {
    const completedAt = new Date().toISOString();
    const result = this.db
      .update(adoptions)
      .set({ status: 'completed', completedAt })
      .where(eq(adoptions.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async cancel(id: string): Promise<Adoption | null> {
    const result = this.db
      .update(adoptions)
      .set({ status: 'cancelled' })
      .where(eq(adoptions.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async clear(): Promise<void> {
    this.db.delete(adoptions).run();
  }
}
