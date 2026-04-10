# DDD Integration Patterns

Triad sits at the **API boundary** — it defines what goes in and out of your domain. It does NOT implement domain internals like repositories, aggregates, domain services, factories, or sagas. Those are your choice. This guide shows how Triad endpoints integrate with common DDD patterns.

All examples use the Petstore domain (Pet, Owner, Adoption) for consistency.

---

## Baseline: A Triad Endpoint

```typescript
import { t, endpoint, scenario } from '@triad/core';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name'),
  species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years'),
  status: t.enum('available', 'adopted', 'pending').doc('Adoption status'),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});

const Money = t.value('Money', {
  amount: t.float64().min(0).doc('Monetary amount'),
  currency: t.enum('USD', 'CAD', 'EUR').doc('Currency code'),
});

export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Pet created' },
    400: { schema: ApiError, description: 'Validation error' },
    409: { schema: ApiError, description: 'Duplicate pet' },
  },
  handler: async (ctx) => {
    // Domain patterns plug in here.
  },
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201'),
  ],
});
```

---

## 1. Repositories

A repository encapsulates persistence. Triad doesn't care whether you use Drizzle, Prisma, raw SQL, or an in-memory Map — the handler just delegates.

**Boundary:** Triad defines the API shape (`Pet`). The repository defines the storage shape (`PetEntity`, a DB row, an ORM model). Mapping between them lives in the repository.

```typescript
// You own this — Triad doesn't care about the implementation.
interface PetRepository {
  create(data: { name: string; species: string; age: number }): Promise<PetEntity>;
  findById(id: string): Promise<PetEntity | null>;
  findByNameAndSpecies(name: string, species: string): Promise<PetEntity | null>;
  list(filters: {
    species?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<PetEntity[]>;
}

// Handler delegates to the repository.
handler: async (ctx) => {
  const existing = await ctx.services.petRepo.findByNameAndSpecies(
    ctx.body.name,
    ctx.body.species,
  );
  if (existing) {
    return ctx.respond[409]({
      code: 'DUPLICATE',
      message: `Pet named ${ctx.body.name} already exists as a ${ctx.body.species}`,
    });
  }
  const pet = await ctx.services.petRepo.create(ctx.body);
  return ctx.respond[201](pet.toResponse());
},
```

---

## 2. Aggregate Roots

An aggregate root encapsulates business rules and invariants. The handler loads the aggregate, calls a domain method on it, and saves it back.

**Boundary:** Triad validates what crosses the API boundary. The aggregate validates business rules internally. Triad knows nothing about the aggregate's internal state.

```typescript
// You own this — the aggregate enforces business rules.
class PetAggregate {
  private id: string;
  private status: 'available' | 'adopted' | 'pending';
  private adopterId: string | null = null;
  private events: DomainEvent[] = [];

  adopt(adopterId: string): void {
    if (this.status !== 'available') {
      throw new DomainError('PET_NOT_AVAILABLE', 'Only available pets can be adopted');
    }
    this.status = 'adopted';
    this.adopterId = adopterId;
    this.events.push(new PetAdoptedEvent(this.id, adopterId, new Date()));
  }

  pullEvents(): DomainEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

// Handler loads aggregate, calls domain method, saves, publishes events.
handler: async (ctx) => {
  const pet = await ctx.services.petRepo.findById(ctx.params.id);
  if (!pet) return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });

  try {
    pet.adopt(ctx.body.adopterId);
    await ctx.services.petRepo.save(pet);
    await ctx.services.eventBus.publishAll(pet.pullEvents());
    return ctx.respond[200](pet.toResponse());
  } catch (err) {
    if (err instanceof DomainError) {
      return ctx.respond[409]({ code: err.code, message: err.message });
    }
    throw err;
  }
},
```

---

## 3. Domain Services

A domain service contains business logic that doesn't belong to a single entity or aggregate — typically cross-aggregate operations or policy computations.

**Boundary:** Triad's value objects (`Money`) live at the API boundary. The domain service computes them internally. The handler is a thin adapter.

```typescript
// You own this — cross-aggregate business logic.
class AdoptionFeeService {
  constructor(
    private readonly pricingPolicy: PricingPolicy,
    private readonly discountRepo: DiscountRepository,
  ) {}

  async calculateFee(
    pet: PetEntity,
    adopter: AdopterEntity,
  ): Promise<{ amount: number; currency: string }> {
    const baseFee = this.pricingPolicy.getBaseFee(pet.species);
    const seniorDiscount = pet.age > 8 ? 0.5 : 1.0;
    const returningAdopterDiscount =
      await this.discountRepo.getReturningAdopterDiscount(adopter.id);
    return {
      amount: baseFee * seniorDiscount * returningAdopterDiscount,
      currency: 'USD',
    };
  }
}

// Handler delegates to the domain service.
handler: async (ctx) => {
  const pet = await ctx.services.petRepo.findById(ctx.params.id);
  if (!pet) return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });

  const fee = await ctx.services.adoptionFeeService.calculateFee(pet, ctx.user);
  return ctx.respond[200]({ pet: pet.toResponse(), adoptionFee: fee });
},
```

---

## 4. Factories

A factory constructs complex domain objects from validated input plus system-generated data (IDs, timestamps, defaults).

**Boundary:** Triad validates the API input (`CreatePet`). The factory transforms it into a full domain entity. This separates API validation (Triad) from domain object construction (you).

```typescript
// You own this — constructs domain objects from validated input.
class PetFactory {
  create(input: { name: string; species: string; age: number }): PetEntity {
    return new PetEntity({
      id: crypto.randomUUID(),
      name: input.name,
      species: input.species,
      age: input.age,
      status: 'available',              // Rule: pets always start as available
      intakeDate: new Date(),
      medicalClearance: false,          // Rule: must pass vet check before adoption
      adoptionFee: this.calculateDefaultFee(input.species),
    });
  }

  private calculateDefaultFee(species: string): number {
    const fees: Record<string, number> = { dog: 150, cat: 100, bird: 75, fish: 25 };
    return fees[species] ?? 50;
  }
}

// Handler uses factory for creation.
handler: async (ctx) => {
  // ctx.body is already validated by Triad against CreatePet.
  const pet = ctx.services.petFactory.create(ctx.body);
  await ctx.services.petRepo.save(pet);
  return ctx.respond[201](pet.toResponse());
},
```

---

## 5. Saga / Process Manager

A saga orchestrates a multi-step process with compensation. The handler kicks off the saga; the saga manages the flow and rollback.

**Boundary:** Triad's behaviors test both happy and failure paths of the saga through the API. The saga itself is pure domain logic.

```typescript
// You own this — orchestrates a multi-step process with compensation.
class AdoptionSaga {
  async execute(
    petId: string,
    adopterId: string,
    paymentMethod: string,
  ): Promise<AdoptionResult> {
    // Step 1: Place hold on pet
    const hold = await this.petRepo.placeHold(petId, adopterId);

    try {
      // Step 2: Process payment
      const payment = await this.paymentService.charge(adopterId, paymentMethod, hold.fee);

      // Step 3: Finalize adoption
      const pet = await this.petRepo.findById(petId);
      pet.adopt(adopterId);
      await this.petRepo.save(pet);

      await this.eventBus.publish(
        new AdoptionCompletedEvent(petId, adopterId, payment.id),
      );
      return { status: 'completed', pet: pet.toResponse(), paymentId: payment.id };
    } catch (err) {
      // Compensation: release hold if payment or adoption fails
      await this.petRepo.releaseHold(petId);
      if (err instanceof PaymentError) {
        return { status: 'payment_failed', error: err.message };
      }
      throw err;
    }
  }
}

// Handler kicks off the saga.
handler: async (ctx) => {
  const result = await ctx.services.adoptionSaga.execute(
    ctx.params.id,
    ctx.body.adopterId,
    ctx.body.paymentMethod,
  );
  if (result.status === 'completed') {
    return ctx.respond[200](result);
  }
  return ctx.respond[402]({ code: 'PAYMENT_FAILED', message: result.error });
},

// Behaviors document the full saga — happy path AND compensation paths.
behaviors: [
  scenario('Successful adoption completes all steps')
    .given('an available pet and a valid adopter with payment')
    .setup(async (services) => {
      const pet = await services.petRepo.create({ name: 'Buddy', species: 'dog', age: 3 });
      const adopter = await services.adopterRepo.create({ name: 'Alice' });
      return { petId: pet.id, adopterId: adopter.id };
    })
    .body({ adopterId: '{adopterId}', paymentMethod: 'card_visa_4242' })
    .when('I adopt the pet')
    .then('response status is 200')
    .and('response body has status "completed"'),

  scenario('Failed payment releases the hold on the pet')
    .given('an available pet and an adopter with declined payment')
    .setup(async (services) => {
      const pet = await services.petRepo.create({ name: 'Whiskers', species: 'cat', age: 5 });
      const adopter = await services.adopterRepo.create({ name: 'Bob' });
      return { petId: pet.id, adopterId: adopter.id };
    })
    .body({ adopterId: '{adopterId}', paymentMethod: 'card_declined' })
    .when('I adopt the pet')
    .then('response status is 402')
    .and('response body has code "PAYMENT_FAILED"'),
],
```

---

## 6. Where Triad Ends and Your Domain Begins

```
┌──────────────────────────────────────────────────────┐
│  HTTP Request                                        │
├──────────────────────────────────────────────────────┤
│  Triad Layer (API Boundary)                          │
│  ┌────────────────────────────────────────────────┐  │
│  │ Schema validation (t.model, t.value)           │  │
│  │ Request parsing & type inference               │  │
│  │ Response validation (ctx.respond)              │  │
│  │ Behavior testing (scenario/given/when/then)    │  │
│  │ OpenAPI generation                             │  │
│  │ Gherkin generation                             │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│  Handler (ctx) — the bridge                          │
│  Maps API input → domain calls → API output         │
├──────────────────────────────────────────────────────┤
│  Your Domain (you own this)                          │
│  ┌────────────────────────────────────────────────┐  │
│  │ Aggregates & Entities                          │  │
│  │ Value Objects                                  │  │
│  │ Domain Services                                │  │
│  │ Repositories                                   │  │
│  │ Factories                                      │  │
│  │ Domain Events                                  │  │
│  │ Sagas / Process Managers                       │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│  Infrastructure (persistence, queues, external APIs) │
└──────────────────────────────────────────────────────┘
```

**Key principles:**

- **Triad validates the edges** — what comes in and what goes out. Your domain validates business rules internally.
- **The handler is thin** — it maps API concepts to domain concepts and back. It should NOT contain business logic.
- **`ctx.services` is the injection point** — Triad doesn't prescribe how you wire dependencies. Use constructor injection, a DI container, or simple factory functions.
- **Triad schemas and domain entities may differ** — `Pet` (API model) and `PetEntity` (domain object) can have different shapes. The mapping happens in the handler, in a `.toResponse()` method, or in the repository.
- **Behaviors test the API contract, not domain internals** — Unit test your aggregates, repositories, and services separately. Triad behaviors are integration tests of the full API surface.
