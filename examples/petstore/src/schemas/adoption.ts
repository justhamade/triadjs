/**
 * Adoption schemas — the Adoption bounded context.
 *
 * An `Adoption` aggregates a pet, an adopter, and a fee into a single
 * lifecycle: requested → completed (or cancelled). Business rules that
 * live in the aggregate itself (pet must be available, fee must be paid,
 * etc.) would be enforced in the handler or a domain service — Triad
 * just defines what crosses the API boundary.
 */

import { t } from '@triad/core';
import { Money } from './common.js';

export const Adopter = t.model('Adopter', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Adopter identifier'),
  name: t.string().minLength(1).doc('Full name'),
  email: t
    .string()
    .format('email')
    .storage({ unique: true, indexed: true })
    .doc('Contact email'),
});

export const CreateAdopter = Adopter.pick('name', 'email').named('CreateAdopter');

export const Adoption = t.model('Adoption', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Adoption identifier'),
  petId: t
    .string()
    .format('uuid')
    .storage({ references: 'pets.id', indexed: true })
    .doc('The pet being adopted'),
  adopterId: t
    .string()
    .format('uuid')
    .storage({ references: 'adopters.id' })
    .doc('The adopter'),
  status: t
    .enum('requested', 'completed', 'cancelled')
    .storage({ indexed: true })
    .doc('Adoption lifecycle status'),
  fee: Money,
  requestedAt: t
    .datetime()
    .storage({ defaultNow: true })
    .doc('When the adoption was requested'),
  completedAt: t.datetime().optional().doc('When the adoption finalized'),
});

export const AdoptionRequest = t.model('AdoptionRequest', {
  adopterId: t.string().format('uuid').doc('Who is adopting'),
});
