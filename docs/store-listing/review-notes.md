# Notes for the reviewers, and their sign-in

Apple: App Store Connect, the app's version page, **App Review Information**. Google: Play
Console, **App content**, **App access**. Both reviewers must be able to sign in, or the app is
rejected.

Never put a real customer's details, a real password, a Stripe key or any other secret here or
in either store. The values in capitals below are placeholders.

## Sign-in for the reviewers

Our sign-in is a telephone number and a code sent by text. A reviewer cannot receive a text to
our number, so there is a **demo sign-in** (ruling 60): one demo telephone number which, and
only which, accepts one fixed code without sending a text. It works only while
`DEMO_SIGNIN_PHONE` and `DEMO_SIGNIN_CODE` are set on the server. It opens a demo account shown
everywhere as "Demo account — no real orders": orders charge no card and reach no Runner.

- Apple, **Sign-in required**: ticked.
- User name: `REVIEW_PHONE_NUMBER` (the demo number, the same as DEMO_SIGNIN_PHONE, written
  as 07...). Anthony writes the number here once chosen.
- Password: the demo code (DEMO_SIGNIN_CODE). **Typed only into App Store Connect and Play
  Console, never written here or anywhere in the repository.**
- Google, App access: "All or some functionality is restricted", then **Add instructions**:
  name "Demo Shopper", user name and password as above, and the notes below.

If the app asks for a four-number PIN to save an address, the reviewer can choose any four
numbers for the demo account.

## Notes to paste (Apple "Notes"; Google "Any other information")

This app lets people order groceries by talking or tapping. A local courier, called a Runner,
buys the shopping in a supermarket at the shelf price and delivers it for a delivery fee. It is
designed first for blind and partially sighted people, so every screen works with VoiceOver and
TalkBack, text is large, and pinch to zoom is on.

To sign in: press Sign in, type the telephone number above, press Text me a code, then type the code
above. No text message is sent to this demo number. The account is a demo account, with a banner
saying "Demo account — no real orders": you can try ordering all the way to "Send my order and
pay", but no card is charged and no Runner is sent. To see the Runner side, sign in on the Runner
page with the same number and code: it opens a demo Runner, which is never offered a real job.
The Runner page has "Close my Runner account" under More; Shoppers close their account in
Settings.

You can look around without signing in: on the first screen choose Just looking.

To try the voice assistant, Ozi: press the large gold button on the first screen and say, for
example, "I need milk and bread". The app asks for the microphone the first time. Speech is
turned into words and not kept.

Payments are for physical groceries delivered to the door, and the delivery service, taken by
card through Stripe (guideline 3.1.3(e)). The demo account has a demo card saved (ending 4242),
which is not a real card: a demo order is never sent to Stripe and never reaches a Runner. Real
cards cannot be added to the demo account.

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

Say in the instructions: "To see the Runner side, open the Runner page and sign in with the same
number and code. It opens a demo Runner, checked so the screens can be seen, which is never
offered a real job. Close my Runner account is under More." 
