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

If something is wrong

If the api component will not stay running, open its runtime logs from the app page. The messages are written in plain sentences and name the thing that is missing. A message about STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AUTH_TOKEN_SECRET or DATABASE_URL means that variable is still a placeholder or still empty, and the fix is to paste the real value and save.

If the health route says dataBackend is memory, then DATABASE_URL has been overwritten with something that is not a real connection string. Put it back to the name in curly brackets that refers to the database, and save.

If the pages all load but searching for milk finds nothing, the catalogue did not fill. Open the runtime logs and look near the top, at the lines written when the server started. If one of them says the catalogue was empty and was filled, then it worked and the problem is elsewhere. If there is no such line at all, check whether an environment variable called SEED_ON_START has been added with the value false, because that switches it off.

If the landing page loads but nothing you do on it reaches the server, and the browser console mentions the word origin, then ALLOWED_ORIGIN does not match the address you are actually visiting. The two must match character for character, including the https at the front, and ALLOWED_ORIGIN must not end in a slash.

If the web build fails, read the build log. If it failed on the accessibility tests, that is the gate doing its job: a screen has a violation, and the log names the screen and the rule it broke. Fix it in the code and push again, rather than switching the gate off.

If the build fails saying that the version of Node is not available, open package.json at the repository root and change the engines entry for node from twenty four to twenty two, change the file called .nvmrc to say 22.11.0, and push. Node twenty two is the older long term support line and every buildpack has it.

What this deployment is and is not

The database created here is a development database, which is the smallest managed PostgreSQL that App Platform offers. It is not backed up. It is fine for looking at Aldilivery running on the internet, and it is not fine for holding real orders from real people. Before there are real Shoppers, move to a production database cluster, which is a change of two lines in .do/app.yaml.

The api component runs on one basic-xxs instance, which is the smallest size there is. It will be slow to answer the first request after a quiet period.

Sign up does not save anybody yet, and the confirmation screen does not yet create a real order, so no money will move even with a real Stripe key in place. Wiring the web app to the API properly is the next piece of work, and it is listed at the end of BUILD_LOG.md.

There is still no voice, no speech and no telephone in this phase, exactly as planned. The microphone button on the landing page says so when pressed.
