Testing Aldilivery with the people it is for

This file is for Anthony, and for anybody who helps him run a session. It is written the same way as DEPLOY.md, in plain prose with no lists or symbols, so that it reads properly aloud.

Aldilivery is built for blind and partially sighted people, disabled people, older people, and people who find reading hard. Every screen already passes the automated accessibility checks, at normal size and at four hundred percent zoom, and it has been driven end to end in a real browser. None of that tells us whether a real person, using their own screen reader in their own way, can actually shop with it. Only they can tell us that. This guide is how to find out.

What a session is

A session is one person, one facilitator, and about an hour. The person uses Aldilivery on their own phone or computer, with their own screen reader or magnifier, set up the way they always have it. The facilitator gives them a few everyday things to do, one at a time, watches and listens, and writes down what happens. The facilitator does not help unless the person asks, or is stuck and upset.

Five or six sessions will find most of the problems that matter. It is better to run three, fix what they find, and run three more, than to run six all at once and find the same problem six times.

Who to invite

Aim for a mix, because different people meet different problems. Somebody who uses a screen reader on a phone, which will usually be VoiceOver on an iPhone or TalkBack on Android. Somebody who uses a screen reader on a computer, which will usually be NVDA or JAWS on Windows. Somebody with some sight who uses magnification or very large text. Somebody older who is not confident with technology. And somebody who finds reading hard. One person may be several of these.

Sight loss charities and disability organisations can help you find people, and many of them run user testing panels for exactly this. The Royal National Institute of Blind People, Thomas Pocklington Trust, AbilityNet, local sight loss societies and Age UK are good places to start. Say plainly what the session is, how long it takes, that it can be done at home on their own device, and what you will pay.

Pay people for their time. They are doing skilled work, and testing with disabled people for free is the same as asking any other expert to work for free. Agree the amount before the session, and pay it whether or not the session goes smoothly.

Before the session, for the person taking part

Send the invitation in a form they can read, which means plain text in the body of an email, not a scanned letter, a picture or a complicated attachment. Tell them what will happen, that it is Aldilivery being tested and not them, that they can stop at any time, and whether you would like to record the session. Ask whether they have any access needs for the session itself, such as extra time, breaks, or a particular way of joining a video call.

Ask for their agreement to take part, and separately to any recording. Recording is optional. If they say no, take written notes instead. Write down only what you need: what happened on each task, and what they said about it. Do not keep their real phone number, address or card details anywhere, because the session does not need them.

Before the session, for the facilitator

On the day, check that the live site is working. Visit the app address with slash api slash health on the end, and check that status says o k and paymentsMode says stripe. Stripe is in test mode, so no real money can move. Tell the person that, because being asked for a card and then told money has been taken is alarming if nobody has explained.

Go through every task below yourself first, on the same kind of device and screen reader the person will use if you can. NVDA is free for Windows, and VoiceOver is already on every iPhone and Mac. If you have never listened to a screen reader before, spend ten minutes with it before the session, so that you can follow what the person hears.

Have these ready to read out to the person when a task needs them. They are made up, so nobody types anything real.

The name to use is ZZ TEST ROW do not use, with the first three words in capital letters and the last three in small letters. It is odd on purpose: it is the name the clean-up script looks for, so every test account can be removed afterwards in one go. The script only recognises it typed exactly like that, so glance at what they typed, and if it is different, write down the phone number they used so that account can be found later.

The phone number to use is 07700 900 followed by any three numbers, a different three for each person. Numbers beginning 07700 900 are set aside for testing and made-up examples, and no real phone uses them.

The address to use is 1 Test Street, Leeds, LS1 1AA.

The card number to use is 4000 0082 6000 0000, which is a test card that Stripe provides, issued as if in the United Kingdom. Any expiry date in the future, and any three numbers for the security code.

Starting the session

Thank them. Explain that you are testing Aldilivery and not them, that nothing they do can be wrong, and that finding problems is the whole point, so a task that goes badly is useful. Ask them to think aloud as they go, saying what they are looking for, what they expected, and what surprised them. Tell them they can stop, take a break, or skip a task whenever they like.

Ask a few questions first, and write down the answers. What device and screen reader or magnifier they are using. How often they shop online, and what they use. What usually goes wrong for them on shopping websites.

Then give them the app address and let them open it their own way.

The tasks

Give one task at a time, in your own words, as something they want to do rather than instructions. Do not say the names of buttons or headings, because then you are testing whether they can find a word you said, not whether they can shop. If a task is taking a very long time and they are getting frustrated, it is fine to move on, and that is itself the finding.

Task one, first impressions. Say: this is a new shopping service. Have a look around and tell me what you think it is, and what you think you can do here. Listen for whether they understand it is a grocery delivery service, whether they find the skip link at the very top, whether they use headings to move around, and what they make of the large microphone button.

Task two, the microphone. Say: there is a button that lets you talk to it. Try it. It is not finished yet, and it should say so in words. Listen for whether they heard that message, and whether they understood what to do instead.

Task three, setting up. Say: you would like to use this, so set yourself up. Give them the made-up name, phone number and address when they ask. Listen for whether every field is announced with its name and its hint, whether they understood the question about what the Runner should do at the door, whether the three choices about substitutions made sense, and what happened when they pressed the button.

Task four, adding a card. They will usually arrive at this straight after setting up. Say: it wants a card, so use this one, and read out the test card. Listen carefully here, because this is the part the automated checks cannot see: the card number, expiry date and security code are drawn by Stripe inside a frame of its own. Does each field say what it is. Did they notice the postcode had already been filled in for them. Did they hear that the card was saved, and that nothing had been charged.

Task five, finding shopping. Say: you want some milk and some bread. Listen for whether they found the search, whether the results made sense read aloud, whether they heard the message saying each thing had been added to the basket, and whether prices were clear.

Task six, something that is not there. Say: you would also like a bottle of wine. There is no wine for sale, on purpose, and the page should say nothing matched. Listen for whether that was clear, or whether it sounded like something had gone wrong.

Task seven, changing your mind. Say: you would like two lots of milk, and actually you do not want the bread after all. Listen for whether they found the basket, whether they could change the number, and whether they could remove the bread and knew it had gone.

Task eight, sending the order. Say: go ahead and send the order. Before they press the final button, ask: how much do you think this will cost, and is there anything that could make it more. Listen for whether they understood the fee, and that the shopping price may change a little because the Runner pays what the till says. After they press it, ask: what has just happened, and what happens next. Listen for whether they were certain the order had gone.

Task nine, only once signing in by text has been switched on. Say: you are now on a different phone or computer, and you want to get back into your account. This task needs a real mobile that can receive the text, so only do it if they are happy to use their own number, and only after Twilio is set up as DEPLOY.md describes. Listen for whether they found where to sign in, and whether the code from the text was offered to them automatically.

After the tasks

Ask these, and write down what they say in their own words. What was easiest. What was hardest, or most annoying. Was there any moment you were not sure whether something had worked. Would you trust this with your real card. What would stop you using it. Is there anything you expected to be able to do that you could not.

Thank them again, and pay them.

Writing down what happened

Keep one short record for each session. At the top, the date, the device, the screen reader or magnifier and its version if they know it, and how confident they are online. Nothing that identifies them.

Then, for each task, write one of three things: finished on their own, finished with help, or not finished. Then a sentence or two about what happened, using their words where you can. When something went wrong, write exactly what they heard or saw at that moment, if you know, and what they were trying to do.

After all the sessions, go through the records and pull out every problem. For each one, write which screen it was on, what happened, how many people it happened to, and how bad it was. Use three levels. It stopped them, meaning they could not finish without help. It slowed them down, meaning they finished but struggled. It annoyed them, meaning it did not get in the way but they noticed it. Problems that stopped somebody are fixed first, whatever else is going on.

Bring that list back here. Each problem becomes a fix, with a test so that it cannot quietly come back, and a line in BUILD_LOG.md saying who found it and what changed.

Afterwards

Remove the test accounts. In the DigitalOcean dashboard, open the app, go to the Console tab, choose the api component, and type node packages/api/scripts/delete-test-rows.mjs and press enter. It lists every account with the test name and deletes nothing. If the list is only test accounts, type the same thing again with a space and dash dash yes on the end, and they are removed, with their cards and orders.

Delete any recordings once the notes are written, unless the person agreed to them being kept, and never keep them longer than you said you would.

What this does not replace

A session like this finds whether people can use Aldilivery. It is not a formal accessibility audit against the Web Content Accessibility Guidelines, and it is not legal advice. Before real customers use it, it is worth having an independent accessibility audit as well, from an organisation that does them.
