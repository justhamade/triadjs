/**
 * Pet schemas — the core of the Pets bounded context.
 *
 * `Pet` is the canonical response shape. `CreatePet` and `UpdatePet` are
 * derived via `.pick()` and `.partial()` so there is only one source of
 * truth for pet fields. Adding a field to `Pet` automatically flows into
 * the derived schemas (unless you explicitly exclude it).
 */

import { t } from '@triad/core';
import { Money } from './common.js';

export const Pet = t.model('Pet', {
  // `.identity()` is the DDD identity marker; `.storage({ primaryKey })`
  // is the parallel storage hint. Today these live side-by-side with
  // the Drizzle table definition in `src/db/schema.ts`; a future
  // `triad db` command will generate the Drizzle table directly from
  // these hints so there is only one source of truth.
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique pet identifier'),
  name: t
    .string()
    .minLength(1)
    .maxLength(100)
    .storage({ indexed: true })
    .doc('Pet name')
    .example('Buddy'),
  species: t
    .enum('dog', 'cat', 'bird', 'fish')
    .storage({ indexed: true })
    .doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years').example(3),
  status: t
    .enum('available', 'adopted', 'pending')
    .storage({ indexed: true })
    .doc('Adoption status')
    .default('available'),
  tags: t
    .array(t.string())
    .optional()
    .doc('Searchable tags (e.g. "vaccinated", "house-trained")'),
  adoptionFee: Money,
  createdAt: t
    .datetime()
    .storage({ defaultNow: true })
    .doc('When the pet was registered in the store'),
});

/** Input for POST /pets — only the fields a client is allowed to set. */
export const CreatePet = Pet.pick('name', 'species', 'age', 'tags').named('CreatePet');

/** Input for PATCH /pets/:id — every mutable field is optional. */
export const UpdatePet = Pet.pick('name', 'age', 'tags').partial().named('UpdatePet');
