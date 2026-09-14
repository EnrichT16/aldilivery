/**
 * What the migrations are allowed to ask the database for.
 *
 * The second DigitalOcean deployment failed with Prisma P3018, SQLSTATE 42501, permission
 * denied for database. `prisma migrate diff` had generated `CREATE SCHEMA IF NOT EXISTS
 * "public"` at the top of the initial migration, and the user a managed provider hands you is
 * not a superuser: it has CREATE on the public schema and nothing on the database itself. The
 * `IF NOT EXISTS` does not help, because PostgreSQL checks the privilege before it checks
 * whether the schema is already there.
 *
 * Deleting that line fixed it. This test is here so that it stays deleted. Regenerating the
 * migration puts it straight back, and the failure it causes appears only on a real managed
 * database, minutes into a deployment, long after anything local would have caught it.
 *
 * Comments are stripped before anything is checked, so the explanation written at the top of
 * the migration — which necessarily names the statements it is warning about — does not trip
 * the test that enforces it.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(apiRoot, 'prisma', 'migrations');
const schemaPath = join(apiRoot, 'prisma', 'schema.prisma');

/**
 * Statements that need a privilege on the database, or on the server, rather than on the
 * public schema. A managed PostgreSQL user has none of them.
 */
const NEEDS_DATABASE_PRIVILEGE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bCREATE\s+SCHEMA\b/i, why: 'needs CREATE on the database' },
  { pattern: /\bDROP\s+SCHEMA\b/i, why: 'needs ownership of the schema' },
  { pattern: /\bALTER\s+SCHEMA\b/i, why: 'needs ownership of the schema' },
  { pattern: /\bCREATE\s+EXTENSION\b/i, why: 'usually needs a superuser' },
  { pattern: /\bALTER\s+DATABASE\b/i, why: 'needs ownership of the database' },
  { pattern: /\bCREATE\s+DATABASE\b/i, why: 'needs CREATEDB' },
  { pattern: /\bDROP\s+DATABASE\b/i, why: 'needs ownership of the database' },
  { pattern: /\bCOMMENT\s+ON\s+DATABASE\b/i, why: 'needs ownership of the database' },
  { pattern: /\bCREATE\s+ROLE\b/i, why: 'needs CREATEROLE' },
  { pattern: /\bALTER\s+SYSTEM\b/i, why: 'needs a superuser' },
  { pattern: /\bALTER\s+ROLE\b/i, why: 'needs CREATEROLE' },
];

/** SQL with its comments taken out, so a warning about a statement is not the statement. */
function withoutComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function migrationFiles(): Array<{ name: string; sql: string }> {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((entry) => existsSync(join(migrationsDir, entry, 'migration.sql')))
    .map((entry) => ({
      name: entry,
      sql: readFileSync(join(migrationsDir, entry, 'migration.sql'), 'utf8'),
    }));
}

describe('the migrations run as an ordinary managed database user', () => {
  const migrations = migrationFiles();

  it('there is at least one migration to check', () => {
    // Without this, every test below would pass by having nothing to look at.
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations.map((migration) => migration.name))(
    '%s asks for nothing that needs a privilege on the database',
    (name) => {
      const migration = migrations.find((candidate) => candidate.name === name);
      const sql = withoutComments(migration?.sql ?? '');

      const offenders = NEEDS_DATABASE_PRIVILEGE.filter(({ pattern }) => pattern.test(sql)).map(
        ({ pattern, why }) => `${String(pattern)} — ${why}`,
      );

      expect(
        offenders,
        `${name} contains a statement a managed PostgreSQL user may not run. It will fail with SQLSTATE 42501 on deployment, minutes in, and nowhere before that.`,
      ).toEqual([]);
    },
  );

  it('creates its tables and types in whatever schema the connection is already using', () => {
    // The corollary of having no CREATE SCHEMA: nothing may name a schema explicitly either,
    // or it would depend on a schema nothing in this repository is allowed to create.
    for (const { name, sql } of migrations) {
      const qualified = withoutComments(sql).match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"[^"]+"\./i);
      expect(qualified, `${name} names a schema on a CREATE TABLE`).toBeNull();
    }
  });
});

describe('the Prisma schema needs no extension and no schema of its own', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const datasource = schema.match(/datasource\s+\w+\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  it('declares no schemas list, which would make Prisma create schemas', () => {
    expect(datasource).not.toMatch(/\bschemas\s*=/);
  });

  it('turns on no preview feature that installs extensions', () => {
    expect(schema).not.toMatch(/postgresqlExtensions/);
    expect(schema).not.toMatch(/\bextensions\s*=\s*\[/);
  });

  it('generates every id with cuid, so no extension is needed to make one', () => {
    // pgcrypto's gen_random_uuid() and uuid-ossp's uuid_generate_v4() both need an extension
    // installed by a superuser. cuid() is generated by Prisma before the insert, so the
    // database is never asked for anything it cannot do.
    const ids = schema.split(/\r?\n/).filter((line) => /@id\b/.test(line));

    expect(ids.length).toBeGreaterThan(0);
    for (const line of ids) {
      expect(line, `every @id must use cuid(): ${line.trim()}`).toMatch(/@default\(cuid\(\)\)/);
    }
  });

  it('asks the database to generate nothing at all', () => {
    expect(schema).not.toMatch(/dbgenerated/);
    expect(schema).not.toMatch(/gen_random_uuid|uuid_generate_v4/);
  });
});
