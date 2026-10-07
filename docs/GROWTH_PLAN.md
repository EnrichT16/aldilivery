Growing to millions of users

Written for Anthony, 7 October 2026, who expects 1 to 10 million users (Shoppers, Runners, Shop Partners and organisations) within six months to a year.

The short answer: the way Ozi Delivery is built can grow to that size. The way it is set up on DigitalOcean today cannot, and is not meant to. Growing is a series of steps, each taken when the numbers call for it, not all at once, because each step costs money every month.


Why the design can grow

- The server keeps no memory of who is signed in. Every request carries a signed token. So instead of one copy of the server, we can run two, ten or fifty side by side, and any of them can answer anyone.
- The data lives in PostgreSQL, which holds tens of millions of accounts in many companies when it is set up and looked after properly.
- Every rule about money is written once, in one place, with tests. Growing does not change any of them.
- The blueprint already treats each region (Medway, then others, then Nigeria and Kenya) as its own marketplace. That is also how a very large service splits its data.

10 million registered users is not 10 million at once. Usually 1 to 5 in every 100 are using an app at the same moment: 100,000 to 500,000 at the busiest time. Large, but well understood.


The steps, and when

1. Before launch (now).
   - The managed PostgreSQL database with daily backups (LAUNCH.md, step 5).

2. At about 50,000 users.
   - Move photos (Runner documents, problem evidence, Shop Partner products) out of the database and into DigitalOcean Spaces (file storage), served through its CDN (a network that delivers images quickly from near the person). Today they sit in the database, which is fine at the start but slows it down at volume.
   - Add a proper search index for products (PostgreSQL trigram or full-text search). Today's search compares text, which is fine for thousands of products, not millions.
   - Load long lists a page at a time in the admin panel and the organisation dashboard. Today they load everything at once.
   - Error and performance monitoring, with alerts to Anthony's phone.

3. At about 500,000 users.
   - Several copies of the server behind a load balancer (a traffic controller that shares visitors between them). DigitalOcean App Platform does this by raising the instance count.
   - A connection pooler (PgBouncer) in front of the database, so thousands of requests share a few hundred database connections.
   - A read-only copy of the database (a read replica) for dashboards, reports and searches, so they never slow down orders.
   - A job queue for offers to Runners, payouts, notifications and reminders, so they run in the background rather than inside a request.
   - Load testing: simulating the expected crowd before each widening.

4. At 1 million users and above.
   - Bigger database machines, with a standby copy ready to take over (high availability).
   - Splitting data by region, so each marketplace has its own database.
   - A content delivery network for the whole web app, and caching of the catalogue.
   - At this size, consider moving from DigitalOcean to a larger cloud (AWS, Google Cloud or Azure). The code moves with it unchanged; only the setup does.


What it costs

Roughly, and rising with use: tens of pounds a month at launch; a few hundred at 50,000 users; low thousands at 500,000; more at millions. Stripe, Twilio and LiveKit charge per use, so they rise with orders and calls, and are covered by them.


What Claude does at each step

Each step is code and settings Claude can write when asked, with Anthony making the changes in DigitalOcean that need his account. Tell Claude the number of users when it is getting close to the next step.
