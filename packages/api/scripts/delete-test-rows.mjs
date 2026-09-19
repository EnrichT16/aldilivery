/**
 * Remove the test Shoppers left in a database by an end to end check.
 *
 * This is a maintenance script and deliberately not a route. Aldilivery has no way to delete
 * somebody's account for real — `POST /account/delete` sets a date seven days out and the
 * account sits in a recycle bin until then, because people change their minds and people are
 * sometimes talked into pressing things. That is the right behaviour for a Shopper and the
 * wrong tool for clearing up after a test, so this exists separately, outside the server, and
 * has to be run by hand with the database address given to it.
 *
 * What it will delete: Shoppers whose display name is exactly the marker below. Nothing else.
 * There is no argument for deleting anybody else, no pattern matching on anything a real
 * person might be called, and no way to ask it to delete everything.
 *
 * Their payment methods, orders, order items and offers go with them, because the schema
 * cascades from Shopper. Nothing else is touched: the catalogue, any Runners and any real
 * Shoppers are left exactly as they are.
 *
 * Usage, from the repository root:
 *
 *   DATABASE_URL="postgresql://..." node packages/api/scripts/delete-test-rows.mjs
 *
 * That lists what it found and stops. To actually delete, add --yes:
 *
 *   DATABASE_URL="postgresql://..." node packages/api/scripts/delete-test-rows.mjs --yes
 */

import { PrismaClient } from '@prisma/client';

/** The exact display name the end to end checks use. Deliberately hard to type by accident. */
const TEST_MARKER = 'ZZ TEST ROW do not use';

const reallyDelete = process.argv.includes('--yes');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set, so there is no database to work on. Give it the connection string from the DigitalOcean database page.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const shoppers = await prisma.shopper.findMany({
    where: { displayName: TEST_MARKER },
    select: {
      id: true,
      displayName: true,
      phone: true,
      createdAt: true,
      _count: { select: { orders: true, paymentMethods: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (shoppers.length === 0) {
    console.log(`No Shoppers named "${TEST_MARKER}". Nothing to do.`);
    process.exit(0);
  }

  console.log(`Found ${shoppers.length} test Shopper${shoppers.length === 1 ? '' : 's'}:`);
  for (const shopper of shoppers) {
    console.log(
      `  ${shopper.phone}  created ${shopper.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${shopper._count.orders} order(s), ${shopper._count.paymentMethods} card(s)`,
    );
  }

  // A sanity check that costs nothing and would catch a marker that had gone wrong.
  const everybody = await prisma.shopper.count();
  console.log(`\n${shoppers.length} of ${everybody} Shoppers in the database would be deleted.`);

  if (!reallyDelete) {
    console.log('\nNothing has been deleted. Run it again with --yes to go ahead.');
    process.exit(0);
  }

  const { count } = await prisma.shopper.deleteMany({ where: { displayName: TEST_MARKER } });
  console.log(`\nDeleted ${count} Shopper${count === 1 ? '' : 's'}.`);
  console.log('Their cards, orders, order items and offers went with them, by cascade.');

  const remaining = await prisma.shopper.count();
  console.log(`${remaining} Shopper${remaining === 1 ? '' : 's'} left in the database.`);
} catch (failure) {
  console.error('Nothing was deleted. The database said:', failure.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
