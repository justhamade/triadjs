/**
 * Drizzle-backed `PetRepository`.
 *
 * This is the concrete expression of the "repository as translation
 * layer" pattern. Everything that differs between the API and storage
 * contracts happens in two places only: `rowToApi()` and `apiToRow()`.
 * Every query uses Drizzle's type-safe query builder.
 *
 * Compared to a hand-rolled in-memory implementation, this version:
 *   - Uses real SQL with Drizzle's type-safe query builder
 *   - Persists across process boundaries (when pointed at a file)
 *   - Returns rows in a deterministic order via explicit ORDER BY
 *   - Demonstrates Money (value object) → two columns mapping
 *   - Demonstrates string[] tags → JSON text column mapping
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';
import type { InferRow, InferInsert } from '@triad/drizzle';

import type { Db } from '../db/client.js';
import { pets } from '../db/schema.js';
import type { Pet as PetSchema } from '../schemas/pet.js';

type Pet = Infer<typeof PetSchema>;
type PetRow = InferRow<typeof pets>;
type PetInsert = InferInsert<typeof pets>;

export interface PetFilter {
  species?: Pet['species'];
  status?: Pet['status'];
  limit: number;
  offset: number;
}

export interface CreatePetInput {
  name: string;
  species: Pet['species'];
  age: number;
  tags?: string[];
}

export interface UpdatePetInput {
  name?: string;
  age?: number;
  tags?: string[];
}

/** Default adoption fee (in cents) by species. */
const DEFAULT_FEE_CENTS: Record<Pet['species'], number> = {
  dog: 15000,
  cat: 10000,
  bird: 7500,
  fish: 2500,
};

export class PetRepository {
  constructor(private readonly db: Db) {}

  // --------------------------------------------------------------------
  // Mapping helpers — the whole point of the repository layer
  // --------------------------------------------------------------------

  private rowToApi(row: PetRow): Pet {
    const pet: Pet = {
      id: row.id,
      name: row.name,
      species: row.species,
      age: row.age,
      status: row.status,
      adoptionFee: {
        amount: row.adoptionFeeAmount,
        currency: row.adoptionFeeCurrency,
      },
      createdAt: row.createdAt,
    };
    if (row.tags !== null) {
      pet.tags = JSON.parse(row.tags) as string[];
    }
    return pet;
  }

  private apiToRow(input: CreatePetInput): PetInsert {
    return {
      id: crypto.randomUUID(),
      name: input.name,
      species: input.species,
      age: input.age,
      status: 'available',
      tags: input.tags !== undefined ? JSON.stringify(input.tags) : null,
      adoptionFeeAmount: DEFAULT_FEE_CENTS[input.species],
      adoptionFeeCurrency: 'USD',
      createdAt: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------

  async create(input: CreatePetInput): Promise<Pet> {
    const row = this.apiToRow(input);
    this.db.insert(pets).values(row).run();
    // The row object is already complete — no need to round-trip through SELECT.
    return this.rowToApi(row as PetRow);
  }

  async findById(id: string): Promise<Pet | null> {
    const row = this.db.select().from(pets).where(eq(pets.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async findByNameAndSpecies(
    name: string,
    species: Pet['species'],
  ): Promise<Pet | null> {
    const row = this.db
      .select()
      .from(pets)
      .where(and(eq(pets.name, name), eq(pets.species, species)))
      .get();
    return row ? this.rowToApi(row) : null;
  }

  async list(filter: PetFilter): Promise<Pet[]> {
    const conditions = [];
    if (filter.species) conditions.push(eq(pets.species, filter.species));
    if (filter.status) conditions.push(eq(pets.status, filter.status));

    const base = this.db.select().from(pets);
    const filtered =
      conditions.length > 0 ? base.where(and(...conditions)) : base;
    const rows = filtered
      .orderBy(asc(pets.createdAt))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();

    return rows.map((r) => this.rowToApi(r));
  }

  async update(id: string, patch: UpdatePetInput): Promise<Pet | null> {
    const updates: Partial<PetInsert> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.age !== undefined) updates.age = patch.age;
    if (patch.tags !== undefined) updates.tags = JSON.stringify(patch.tags);
    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }
    const result = this.db
      .update(pets)
      .set(updates)
      .where(eq(pets.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async setStatus(
    id: string,
    status: Pet['status'],
  ): Promise<Pet | null> {
    const result = this.db
      .update(pets)
      .set({ status })
      .where(eq(pets.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async clear(): Promise<void> {
    this.db.delete(pets).run();
  }
}
