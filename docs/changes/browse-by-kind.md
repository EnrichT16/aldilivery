# Browsing places by kind: Restaurants, Shops, Convenience stores and Services

Decided by Anthony on 25 October 2026, recorded as ruling 82 in docs/BUILD_PROMPT.md. It builds on the partners of ruling 65 (shops, cafés and takeaways, and services, the public shops list and the shops Ozi lists itself from config/shops-seed.json) and on ruling 75, which lists shops on paid Partner Plus above free ones.

## Why

Until now every approved shop, café, takeaway and service sat together in one list on the shops page. As more places join, a Shopper looking for a takeaway tonight, a Turkish grocer or a plumber has to read past everything else to find them. Anthony asked for four separate places to browse, each easy to reach from the home page and each with its own address, so that the address can be printed on a flyer and taken straight to the right page.

## The four pages

There are four pages: Restaurants at /restaurants, Shops at /shops, Convenience stores at /convenience and Services at /services. On the Shopper's home page they appear as four large tiles near the top, just under "Just say it", each with its words and a picture that is only decoration. At the top of each of the four pages the same four appear as tabs, with the page you are on marked as the current page, so a screen reader says so. The bottom bar is unchanged: its Shops button opens the Shops page, which now has the four tabs at its top. The little round chips further down the home page for cafés and takeaways and for services now open the Restaurants and Services pages.

Restaurants lists the restaurants, cafés and takeaways we have an agreement with, which are the approved partners of the café or takeaway kind. Shops lists the approved shops that are not convenience stores, including the well-known shops Ozi lists itself. Convenience stores lists corner shops, convenience stores and mini-markets. Services lists the approved services.

Each place on a page is a disclosure: a button with the place's name, its kind, its area and what it is chosen under, which says whether it is open or closed, and which opens to the place's words about itself, its opening hours and a link to its own page. Nothing opens on hover.

## Country and continental

At the top right of the Restaurants page and of the Shops page is a button called "Country and continental". It is a disclosure too: pressing it opens a list of buttons, and choosing one lists only the places of that kind, with the choice kept in the address (for example /restaurants?cuisine=African), so that address can be printed as well. "All restaurants" or "All shops" at the start of the list takes the choice away. On Restaurants the list is the cuisines, from `browse.cuisines` in config/store.json: African, Caribbean, Indian, Pakistani, Bangladeshi, Chinese, Thai, Japanese, Turkish, Middle Eastern, Mediterranean, Italian, Greek, Portuguese, Polish, English, American and the others written there. On Shops it is the shop specialities, from `browse.shopOrigins`: African, Caribbean, Turkish, Indian, Polish, Chinese, Middle Eastern, Eastern European and the others written there. On Services the same button is called "Kinds of service" and lists the categories from `browse.serviceCategories`: Plumber, Electrician, Carpenter, Handyman, Door and window fitter, Cleaner, Nanny and childminder, Cook and chef, Gardener, Hairdresser and barber, Dog walker, Tutor and the others written there. Convenience stores has no list. None of these lists is written in the screens' code; changing the file changes the pages.

The service categories never include a kind of service that is excluded. The configuration refuses to load if a category contains one of the words in `extras.partners.excludedServiceKinds`, so credit, loans, insurance, medicines and the rest stay out, and the join form goes on refusing a business that describes itself in those words.

## Searching, and what is near

Each page has a search box. A search looks through the places' names, their words about themselves, and their cuisines, specialities or categories; the asking words ("find", "near me", "a", "restaurant") are left out, so "an African restaurant" finds the African restaurants. Below the search box is "Your postcode, to see what is near you first", filled in from the Shopper's delivery address when they are signed in.

With a postcode, the places are ordered by postcode alone, because no table of places with their positions is kept in the product. Places in the same postcode district as the Shopper (ME7 and ME7) come first, under the heading "Near you". Then come places in the same postcode area (ME7 and ME8), then everywhere else, under "Further away". Within each of those, shops on paid Partner Plus still come first, as ruling 75 said. Without a postcode, the places are listed under "All restaurants" (or shops, convenience stores or services), with a line inviting the Shopper to give their postcode.

The same filters are on the public list itself: `GET /shops` takes `section`, `cuisine`, `speciality`, `category`, `q` and `near`, and marks each place `nearYou` true or false when a postcode is known. Asked with nothing, it lists everything exactly as before, so the home page's "Stock up at local shops" is unchanged.

## When there is nothing yet

An empty page is honest and encouraging. With nothing found it says, for example, "No African restaurants on Ozi yet. Know one? Tell them to join at ozidelivery.co.uk/business". The name and the address come from configuration: the assistant's name, and `browse.joinAddress` in config/store.json. A search that finds nothing says what was searched for, in the same way.

## How a place gets its cuisine, speciality or category

A partner now has, in both repositories and in the new migration `20261104090000_browse_by_kind`, a list of cuisines (for a café or takeaway), a list of specialities and a convenience flag (for a shop), a list of categories (for a service), and an Ofsted registration number (for a service). Each list is chosen from the lists in config; anything not on the list is refused in plain words, and only the fields the place's kind has are kept, so a café never carries the convenience flag. Choosing to mark a shop as a convenience store, rather than adding a fourth kind of partner, was the least disruptive change: plans, prices and the rest of ruling 65 still see a shop.

A business sets them on the join form, where they appear under the question about its kind, as checkboxes with their words beside them in a fieldset with a heading. On the dashboard, a new part called "How Shoppers find you" lets the partner change them, and its sentence about itself, at any time. Staff set them in People, Shops and organisations when adding a shop from a paper form, and on any shop, under "What Shoppers find it under", when approving it or later. The shops Ozi lists itself from config/shops-seed.json carry them too: the supermarkets are not convenience stores, and the Co-op on Rainham High Street is. Seed shops listed before this change, and still unclaimed, have the file's values filled in the next time staff press "Add the seed shops".

## Nannies, childminders, cooks and other people who come into homes

Some services, such as nannies, childminders and cooks, are people who work in someone's home. Every Services page says plainly that Ozi Delivery does not vet service providers beyond what each listing says, and that people should check anyone themselves before they start; each service's own page and its entry in the list say it too. A childminder must be registered with Ofsted. A provider in a category listed in `browse.ofstedCategories` (Nanny and childminder) must give an "Ofsted registration number" to join or save, written as six to eight digits, sometimes with letters such as EY in front. We show the number as the provider gave it, with the words "as the provider gave it" and that we have not checked it. Nothing on the page suggests that we check it.

## By voice

Ozi understands "find an African restaurant", "Turkish shop near me", "find a plumber" and "show me the convenience stores". It opens the right page with the right choice made, then says how many there are and how many are near, or, if there are none, the same honest words as the page. On any of the four pages, "open" and a place's name opens that place's page. "Is there a barber on Ozi?" is still answered by the phrase book, as ruling 65 set out, and that answer now also looks through cuisines, specialities and categories. Ozi listens for a service only when it is asked for as one thing ("a cleaner", "a plumber near me"), so "get me some kitchen cleaner" stays shopping.

## Accessibility

Every tab, tile, button and checkbox is a real control at least the minimum height, with words beside every picture, and every picture is hidden from screen readers. The Country and continental button and each place say whether they are open. The four pages pass the automatic accessibility checks with the list open and every place expanded.

## Tests

The rules are in `packages/core/test/browse.test.ts`. The list's filters, the convenience flag, the search, the near-and-far order and the fields set by joining, the dashboard and staff are in `packages/api/test/browse-by-kind.test.ts`. The pages, the Country and continental list, the search, the empty states, the home page tiles and the accessibility checks are in `packages/web/test/browse.test.tsx` and `packages/web/test/a11y.test.tsx`, and the join form's new fields in `packages/web/test/partner-join.test.tsx`.
