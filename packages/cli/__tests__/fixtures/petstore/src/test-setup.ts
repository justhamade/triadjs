/**
 * Test services factory used by `triad test` against this fixture.
 * Provides an in-memory pet repository and a `cleanup` method that the
 * Triad CLI calls via the `teardown: 'cleanup'` config.
 */

interface PetRecord {
  id: string;
  name: string;
  species: 'dog' | 'cat' | 'bird' | 'fish';
  age: number;
}

class InMemoryPetRepo {
  private readonly pets = new Map<string, PetRecord>();

  async create(data: Omit<PetRecord, 'id'>): Promise<PetRecord> {
    const id = crypto.randomUUID();
    const pet = { id, ...data };
    this.pets.set(id, pet);
    return pet;
  }

  async findByName(name: string): Promise<PetRecord | null> {
    for (const pet of this.pets.values()) {
      if (pet.name === name) return pet;
    }
    return null;
  }

  async findById(id: string): Promise<PetRecord | null> {
    return this.pets.get(id) ?? null;
  }

  clear(): void {
    this.pets.clear();
  }
}

interface TestServices {
  petRepo: InMemoryPetRepo;
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const petRepo = new InMemoryPetRepo();
  return {
    petRepo,
    async cleanup() {
      petRepo.clear();
    },
  };
}
