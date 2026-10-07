/**
 * A share link for everybody (ruling 44, Anthony, 7 October 2026: "everybody should have a
 * share link"): the owner, staff, family members, investors and Shoppers, each with a meter
 * of how many accounts were opened through it. Runners, partner shops and organisations have
 * had theirs since rulings 21 and 42.
 *
 * Whose link it is comes from the credentials alone. A staff link carries the staff account's
 * id (or "founder" for the staff key), a Shopper's their handle; nothing private is in either.
 */

import type { FastifyInstance } from 'fastify';

import { UnauthorisedError } from '../errors.js';
import { staffActor } from '../lib/staff.js';

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env } = app.ctx;

  app.get('/share', async (request) => {
    let via: string;
    const staff = request.headers['x-staff-token'] ?? request.headers['x-staff-key'];
    if (staff) {
      const actor = await staffActor(request);
      via = `staff:${actor.id ?? 'founder'}`;
    } else if (request.session?.role === 'shopper') {
      const shopper = await repository.shoppers.findById(request.session.accountId);
      if (!shopper) throw new UnauthorisedError();
      via = `shopper:${shopper.handle}`;
    } else {
      throw new UnauthorisedError('Please sign in to get your share link.');
    }
    const origin = env.primaryOrigin ?? '';
    return {
      link: `${origin}/join?via=${via.replace(':', '-')}`,
      joined: await repository.shoppers.countJoinedVia(via),
    };
  });
}
