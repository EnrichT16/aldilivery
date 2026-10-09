# Store listing kit

Everything to paste into App Store Connect (Apple) and the Play Console (Google), written in
advance so that submitting is copying, not writing. docs/APP_STORES.md says when each part is
needed. Prepared 9 October 2026; check every answer again on the day, because both stores change
their forms.

Read these in this order:

1. **description.md**: the name, subtitle, short and full descriptions, keywords and category.
2. **apple-privacy.md**: Apple's "App Privacy" answers (the privacy "nutrition label").
3. **google-data-safety.md**: Google's "Data safety" answers.
4. **age-rating.md**: the age rating questionnaires for both stores.
5. **screenshots.md**: which screens to capture, at what sizes, and the two images already made.
6. **review-notes.md**: what to tell the reviewers, including the sign-in for them.

## The addresses both stores ask for

- Website, marketing URL: https://ozidelivery.co.uk
- Support URL: https://ozidelivery.co.uk/help (the Help and contact page, added for this; it
  has the telephone number, the email address and how to close an account)
- Privacy policy URL: https://ozidelivery.co.uk/privacy
- Terms (Apple's custom licence agreement is not needed; the standard one is fine), for
  reference: https://ozidelivery.co.uk/terms
- Google's "Delete account" URL: https://ozidelivery.co.uk/help#close-account
- Support email: hello@ozidelivery.co.uk, once it is a real mailbox. It is still marked as a
  placeholder in config/store.json (`contact.emailIsPlaceholder`), so the website shows "to
  follow". Both stores need a working email address before submitting.
- Support telephone: the real number, once it replaces the 0800 000 0000 placeholder.

## Two rules for everything written here

- **Do not name the supermarket** in any store text, keyword or screenshot caption. Its name is
  a trade mark; a store can remove an app over a trade mark complaint, and the supermarket has
  an exclusive delivery partner. The listing says "your local supermarket" instead, and that we
  are independent.
- **Every answer must match the privacy policy** (packages/web/src/pages/Privacy.tsx). If the
  app starts collecting something new, the policy, these answers and both stores' forms change
  together.

## Placeholders to replace before submitting

- `REVIEW_PHONE_NUMBER` and `REVIEW_CODE` in review-notes.md: the review sign-in, which has to
  be built first (docs/APP_STORES.md, "Before submitting").
- The telephone number and email above.
- Company number and registered office (config/store.json), which Apple and Google show for a
  trader in some countries.
