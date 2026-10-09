# Notes for the reviewers, and their sign-in

Apple: App Store Connect, the app's version page, **App Review Information**. Google: Play
Console, **App content**, **App access**. Both reviewers must be able to sign in, or the app is
rejected.

Never put a real customer's details, a real password, a Stripe key or any other secret here or
in either store. The values in capitals below are placeholders.

## Sign-in for the reviewers

Our sign-in is a telephone number and a code sent by text. A reviewer cannot receive a text to
our number, so a **review sign-in** has to exist first: one demo telephone number which, and
only which, accepts one fixed code without sending a text. It is not built yet; docs/APP_STORES.md
("Before submitting") says what it needs. Once it is:

- Apple, **Sign-in required**: ticked.
- User name: `REVIEW_PHONE_NUMBER` (the demo number, written as 07... )
- Password: `REVIEW_CODE` (the fixed code)
- Google, App access: "All or some functionality is restricted", then **Add instructions**:
  name "Demo Shopper", user name and password as above, and the notes below.

If the app asks for a four-number PIN after signing in, give the demo account's PIN here as well
(`REVIEW_PIN`).

## Notes to paste (Apple "Notes"; Google "Any other information")

This app lets people order groceries by talking or tapping. A local courier, called a Runner,
buys the shopping in a supermarket at the shelf price and delivers it for a delivery fee. It is
designed first for blind and partially sighted people, so every screen works with VoiceOver and
TalkBack, text is large, and pinch to zoom is on.

To sign in: press Sign in, type the telephone number above, press Text me a code, then type the code
above. No text message is sent to this demo number.

You can look around without signing in: on the first screen choose Just looking.

To try the voice assistant, Ozi: press the large gold button on the first screen and say, for
example, "I need milk and bread". The app asks for the microphone the first time. Speech is
turned into words and not kept.

Payments are for physical groceries delivered to the door, and the delivery service, taken by
card through Stripe (guideline 3.1.3(e)). Please do not complete a payment with a real card:
the demo account has a test card saved, and the demo area has no Runners, so no shopping would
be bought. The confirmation screen, where the price is read back before anything is charged,
shows the whole flow. [Replace this paragraph if the review account is set up differently.]

Location is asked for only in the Runner part of the app, which needs a checked Runner account,
so you will not be asked for it as a Shopper. The camera is used for receipt and problem photos.
Notifications tell people how their order is going.

The app opens only its own pages. Sign in with Apple is not offered because the app uses no
third-party or social sign-in, only a telephone number and code (guideline 4.8).

Contact for the review: Anthony Ibe, `REVIEW_CONTACT_PHONE`, hello@ozidelivery.co.uk.

## Apple contact information (same page)

- First name: Anthony
- Last name: Ibe
- Phone: `REVIEW_CONTACT_PHONE` (a number Anthony answers; Apple rings rarely)
- Email: the Apple ID email Anthony uses for the developer account

## Google "App access" note on Runner features

Runner screens need a Runner whose documents a person has checked. Say in the instructions: "The
Runner side needs a checked Runner account and is not needed to review the Shopper app." If
Google asks to see it, a demo Runner account can be made and checked in the admin panel the same
way as a real one, with made-up documents marked as such.
