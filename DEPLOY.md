Deploying Aldilivery to DigitalOcean

This file is for Anthony. It describes, in order, everything that happens in the DigitalOcean dashboard once this repository has been pushed to GitHub. It assumes you have a DigitalOcean account and that you can sign in to it, and that you have a Stripe account that belongs to Aldilivery and to nothing else. Rule Eight means that Stripe account must not be shared with any other product of yours.

Nothing in this file needs a terminal. Everything is done in a web browser.

What is already in the repository

There is a file at .do/app.yaml which describes the whole application: a service called api, a static site called web, and a managed PostgreSQL database called aldilivery-db. DigitalOcean reads that file when it creates the app, so you are not filling in build commands or ports by hand. What you are filling in are three secrets that must never live in a repository, and one address that does not exist until DigitalOcean has given the app a web address of its own.

Creating the app

Sign in to DigitalOcean and go to the Apps section, then choose Create App. When it asks where the code is, choose GitHub, and authorise DigitalOcean to read your account if it has not already been authorised. Choose the repository called aldilivery, owned by EnrichT16. Choose the branch called main. Leave autodeploy switched on, which means every future push to main deploys itself.

DigitalOcean will then read the app spec out of the repository and show you three things it intends to create: a service named api, a static site named web, and a database named aldilivery-db. If it shows you those three, it has found the spec and you do not need to change any of the build settings. If instead it offers to detect the components itself and shows you only one, stop and check that the file .do/app.yaml really was pushed, because everything below assumes it is there. You can also paste the contents of that file into the dashboard yourself, under Settings and then App Spec.

The secrets to paste before the first deploy

On the review screen, before you press the button that creates the app, open the environment variables for the component named api. Three of them are filled with obvious placeholder text, and Aldilivery refuses to start in production while any of them is still a placeholder. That refusal is deliberate. A server that started without them would take an order it cannot charge for, or accept a webhook it cannot prove came from Stripe.

The first is STRIPE_SECRET_KEY. Get it from the Stripe dashboard, under Developers and then API keys. It is the secret key, not the publishable one. Paste it in place of the placeholder text, and make sure the value is marked as encrypted.

The second is STRIPE_WEBHOOK_SECRET. This one does not exist yet, because it is created when you add a webhook endpoint in Stripe, and that endpoint address needs the app to exist first. For now leave the placeholder alone. You will come back to it in a few minutes, and until you do, the api component will build and then refuse to start. That is expected at this stage rather than a fault.

The third is AUTH_TOKEN_SECRET. This signs the tokens that keep a Shopper signed in. It needs to be a long random string that nobody has ever seen. Any password manager will generate one; ask it for a random password of sixty characters or more. Paste it in and mark it encrypted.

Leave DATABASE_URL exactly as it is. Its value is a name in curly brackets that refers to the database, and DigitalOcean substitutes the real connection string once the database exists. Typing a connection string there by hand would break it.

Leave PORT and NODE_ENV as they are. Leave VITE_API_URL on the web component as it is, which is the four characters, forward slash, a, p, i. That works because the web app and the API are served from the same address, so the browser never makes a cross origin request in ordinary use.

Now create the app. DigitalOcean will build both components and create the database. The build takes several minutes the first time, mostly because the web build runs the linter, the type check and the accessibility tests before it produces a bundle. That is the accessibility gate from Rule Seven, and a screen with an accessibility violation fails the build rather than deploying. The api component will build successfully and then fail to start, and its log will say that STRIPE_WEBHOOK_SECRET is missing. That is correct at this point.

Finding the web address

When the app has been created, DigitalOcean shows its address at the top of the app page. It will look something like the word aldilivery, then some characters, then dot ondigitalocean dot app, and it begins with https. Copy that whole address. Everything below needs it.

Setting the allowed origin

Go to Settings, then to the component named api, then to environment variables, and find ALLOWED_ORIGIN. It is currently empty. Paste the app address into it, exactly as DigitalOcean gave it to you, including the https at the start, and with no slash on the end. This is the only browser origin permitted to call the API. Anything else is refused.

Creating the Stripe webhook and getting the last secret

Go to the Stripe dashboard, to Developers and then Webhooks, and add an endpoint. The endpoint address is your app address followed by forward slash, a p i, forward slash, webhooks, forward slash, stripe. So if the app address were https colon slash slash example dot ondigitalocean dot app, then the endpoint would be that same address with slash api slash webhooks slash stripe on the end.

Choose the events you want sent. Payment intent succeeded and payment intent payment failed are the two that matter for taking an order. Save the endpoint. Stripe then shows a signing secret, which begins with the letters w h s e c. Copy it.

Back in DigitalOcean, in the same environment variables screen for the api component, replace the placeholder in STRIPE_WEBHOOK_SECRET with that signing secret, and make sure it is marked encrypted. Save the changes. Saving environment variables starts a redeploy on its own, so you do not need to trigger one.

Confirming that the health route responds

Wait for the deployment to finish and show as active. Then open a new browser tab and go to your app address followed by forward slash, a p i, forward slash, health. So if the app address were https colon slash slash example dot ondigitalocean dot app, you would visit that same address with slash api slash health on the end.

What comes back is a short piece of JSON on one line. Read it and check four things in it.

The first is a field called status, whose value must be the two letters o k. If you see that, the server is alive and answering.

The second is a field called commit, which holds the git commit that the running server was built from, or the word null if nothing could tell it which commit it is. Either is acceptable, but a commit is better, because it tells you exactly which version is live.

The third is a field called dataBackend, whose value must be the word postgres. If it says memory instead, the database is not connected, and nothing anybody ordered would survive a restart.

The fourth is a field called paymentsMode, whose value must be the word stripe. If it says rehearsal, the Stripe key has not been picked up and no money can move.

If all four are right, the API is live and talking to its database. Now visit the app address on its own, with nothing after it, and you should see the Aldilivery landing page: deep navy, a large gold microphone in the middle, and the line about Ozi shopping for you. Press the Tab key once and a skip link should appear with a thick focus ring around it. That is the accessible shell, running in production.

Then go to the shopping screen and search for something ordinary, like milk or bread, and you should get results. A brand new database has no rows in it, only empty tables, so the server fills the catalogue by itself the first time it starts, with the same everyday grocery list you see when running it on your own machine. You do not have to do anything to make that happen, and it only happens once: restarting the app will not duplicate anything.

Two things about that catalogue are worth knowing. The first is that it writes groceries and nothing else. It creates no Shopper and no Runner, on purpose. A Runner carries two flags saying their right to work and their criminal record check have been verified, and those are decided by a person reading a document, never by a seed script, so nothing automatic is ever allowed to assert one. The database will therefore have no Runners in it until you add real ones, which is correct. The second is that if you search for wine you will get nothing back, even though there is a bottle of red wine sitting in the catalogue. That is Rule Six working.

If the web address works but the api part of it does not

This is worth reading if you ever visit your app address with slash api slash health on the end and get the Aldilivery page back, or a not found page, instead of the short piece of JSON.

The first thing to check is the simplest. If the api component is in the middle of deploying, it is serving nothing at all for a minute or two, and during that time a request to anything under slash api is answered by the static site instead, because the static site is set up to answer any address it does not recognise with the app itself. That comes back with a success code on it, which is why it looks like a routing fault rather than a component that is briefly down. Wait until the app page shows the deployment as active, then try again. Your browser may also have kept the wrong answer for a few minutes, so do a hard refresh, which on Windows is Control and F5 together.

If the deployment is active and it still happens, then the routing rules themselves need looking at. There is a thing that catches people out here. The routing lives in the app spec, in the file in the repository at dot do slash app dot yaml, where the api component claims the path slash api and the static site claims slash. DigitalOcean turns those into what it calls ingress rules when it creates the app. If the spec has ever been edited in the dashboard rather than in the repository, those ingress rules can end up out of step with what the file says, and pushing a new commit will not put them right, because the dashboard copy is the one the app is actually using.

Putting it right means uploading the spec again. Here is exactly what to do.

Sign in to DigitalOcean and open the Apps section, then open the app called aldilivery. Go to the Settings tab. Near the top of that page, in the section headed App Spec, there is an Edit button. Press it and you will see the whole spec as text, in the same shape as the file in the repository.

Before you change anything, select all of that text and copy it somewhere safe, so you can put it back if you need to. Then open the file dot do slash app dot yaml from the repository on GitHub, select all of it, and copy it. Go back to the dashboard, select all of the text in the box, delete it, and paste the file in its place. Press Save.

DigitalOcean will show you what it is about to change before it does anything. Read that summary. It should mention the routes or the ingress rules, and it should not mention deleting the database. If it says anything about removing or replacing the database, stop and do not continue, because the spec you pasted is not describing the same app.

Saving starts a new deployment. When it finishes and shows as active, visit your app address with slash api slash health on the end again. You should get the short piece of JSON with status o k in it.

There is one more reassurance worth having. The API now answers on both addresses, with and without the api part in front, so even if the routing is set up to pass the whole path through rather than trimming it off, the health route still answers. That means if slash api slash health is still giving you a web page after all of the above, the cause is the routing not reaching the api component at all, rather than the path arriving in an unexpected shape. In that case the ingress rules are the thing to look at, and re-uploading the spec as described is the fix.


If something is wrong

If the api component will not stay running, open its runtime logs from the app page. The messages are written in plain sentences and name the thing that is missing. A message about STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AUTH_TOKEN_SECRET or DATABASE_URL means that variable is still a placeholder or still empty, and the fix is to paste the real value and save.

If the health route says dataBackend is memory, then DATABASE_URL has been overwritten with something that is not a real connection string. Put it back to the name in curly brackets that refers to the database, and save.

If the api component will not start and the log mentions a code that reads P three thousand and nine, or says that migrate found failed migrations in the target database, then an earlier attempt to set up the database was interrupted part way through, most likely because the database was still being created at the time. Prisma has written down that the setup failed and will refuse to touch the database again until that record is cleared, which is the right thing for it to do rather than guess about your data. The server now clears that record by itself on the next start and then tries again, up to five times, waiting ten seconds between tries, so the usual fix is simply to redeploy from the Actions menu and let it sort itself out. It clears only Prisma's own note of what has run. It deletes nothing, and there is no command anywhere in Aldilivery that would drop a table or reset the database.

If it still will not start after that, and the log now says something about a table or a type that already exists, then the interrupted attempt had got far enough to create part of the schema before it stopped. That one does need a person. Say the word and I will write the migration that tidies it up. Do not be tempted by anything in the Prisma documentation that mentions resetting the database, because on a database with real orders in it that throws them away.

If the log mentions a code that reads P three thousand and eighteen, together with a database error numbered forty two five zero one and the words permission denied for database, then something in the migration is asking the database for a privilege that the DigitalOcean database user does not have. That user is deliberately not an administrator: it is allowed to create tables inside the database, and not allowed to change the database itself. This was fixed on the fourteenth of September and there is a test that stops it coming back, so you should not see it again. If you ever do, the fix is never to grant the user more power. It is to find the statement in the migration that wants it and take it out.

If the pages all load but searching for milk finds nothing, the catalogue did not fill. Open the runtime logs and look near the top, at the lines written when the server started. If one of them says the catalogue was empty and was filled, then it worked and the problem is elsewhere. If there is no such line at all, check whether an environment variable called SEED_ON_START has been added with the value false, because that switches it off.

If the landing page loads but nothing you do on it reaches the server, and the browser console mentions the word origin, then ALLOWED_ORIGIN does not match the address you are actually visiting. The two must match character for character, including the https at the front, and ALLOWED_ORIGIN must not end in a slash.

If the web build fails, read the build log. If it failed on the accessibility tests, that is the gate doing its job: a screen has a violation, and the log names the screen and the rule it broke. Fix it in the code and push again, rather than switching the gate off.

If the build fails saying that the version of Node is not available, open package.json at the repository root and change the engines entry for node from twenty four to twenty two, change the file called .nvmrc to say 22.11.0, and push. Node twenty two is the older long term support line and every buildpack has it.

What this deployment is and is not

The database created here is a development database, which is the smallest managed PostgreSQL that App Platform offers. It is not backed up. It is fine for looking at Aldilivery running on the internet, and it is not fine for holding real orders from real people. Before there are real Shoppers, move to a production database cluster, which is a change of two lines in .do/app.yaml.

The api component runs on one basic-xxs instance, which is the smallest size there is. It will be slow to answer the first request after a quiet period.

Sign up does not save anybody yet, and the confirmation screen does not yet create a real order, so no money will move even with a real Stripe key in place. Wiring the web app to the API properly is the next piece of work, and it is listed at the end of BUILD_LOG.md.

There is still no voice, no speech and no telephone in this phase, exactly as planned. The microphone button on the landing page says so when pressed.
