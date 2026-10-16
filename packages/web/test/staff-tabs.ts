/**
 * The admin panel's tabs, in four groups (16 October 2026 review), for the tests: open a page by
 * name wherever its group is, and list every page across the groups.
 */

import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

async function nav(): Promise<HTMLElement> {
  return screen.findByRole('navigation', { name: 'Admin pages' });
}

/** The group tabs, as shown. */
export async function groupTabs(): Promise<string[]> {
  const groups = within(await nav()).getByRole('tablist', { name: 'Parts of the admin panel' });
  return within(groups)
    .getAllByRole('tab')
    .map((tab) => tab.textContent ?? '');
}

/** Every page tab, group by group, in the order a person meets them. */
export async function pageTabs(user: User): Promise<string[]> {
  const panel = await nav();
  const groups = within(panel).getByRole('tablist', { name: 'Parts of the admin panel' });
  const names: string[] = [];
  for (const group of within(groups).getAllByRole('tab')) {
    await user.click(group);
    const pages = within(panel).getByRole('tablist', { name: /pages$/ });
    names.push(
      ...within(pages)
        .getAllByRole('tab')
        .map((tab) => tab.textContent ?? ''),
    );
  }
  return names;
}

/** Opens the page called `name`, whichever group it is in. */
export async function openPage(user: User, name: string): Promise<HTMLElement> {
  const panel = await nav();
  const groups = within(panel).getByRole('tablist', { name: 'Parts of the admin panel' });
  for (const group of within(groups).getAllByRole('tab')) {
    await user.click(group);
    const pages = within(panel).getByRole('tablist', { name: /pages$/ });
    const page = within(pages).queryByRole('tab', { name });
    if (page) {
      await user.click(page);
      return page;
    }
  }
  throw new Error(`No admin page is called ${name}.`);
}
