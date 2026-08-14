# Popzilla Ordering App V4

Customer ordering app for Popzilla Gourmet Popcorn & Fudge.

## Run locally
1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Visit http://localhost:3000

## Pay at Pickup
Works immediately and saves orders to `orders.json`.

## Online payments
Set `STRIPE_SECRET_KEY` and `PUBLIC_URL` in the server environment. Use Stripe test keys while testing. Do not put secret keys in browser code.

## Production
Use HTTPS hosting, a persistent database instead of the local JSON file, secure admin authentication, and Stripe webhooks before public launch.
