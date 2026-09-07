# FitForge

A Cloudflare Pages + Workers app that generates a personalized gym and diet program from a short intake form. No build tooling — plain HTML/CSS/JS frontend, Pages Functions backend, D1 for storage, Workers AI for generation.

## Stack

- **Frontend**: `public/` — static HTML/CSS/JS, no framework.
- **Backend**: `functions/api/` — Cloudflare Pages Functions (Workers under the hood).
- **Database**: Cloudflare D1 (SQLite), schema in `schema.sql`.
- **AI**: Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`), free tier.

## Setup

1. Install Wrangler if you don't have it:
   ```
   npm install -g wrangler
   ```
2. Log in:
   ```
   wrangler login
   ```
3. Create the D1 database:
   ```
   wrangler d1 create fitness-planner-db
   ```
   Copy the returned `database_id` into `wrangler.toml`.
4. Apply the schema:
   ```
   wrangler d1 execute fitness-planner-db --file=schema.sql --remote
   ```
5. Run locally:
   ```
   wrangler pages dev public --d1=DB --ai
   ```
6. Deploy:
   ```
   wrangler pages deploy public
   ```

## How it works

1. User fills out the intake form (`public/index.html`) — sex, age, height, weight, body type, activity level, goal, experience, training days, equipment, health conditions, dietary prefs.
2. `POST /api/generate` (`functions/api/generate.js`) builds a prompt from those fields, calls Workers AI for a JSON-shaped gym + diet program, stores the profile and plan in D1, and returns the plan.
3. `GET /api/plan/:id` (`functions/api/plan/[id].js`) re-fetches a previously generated plan.

## Notes on scope

- No photo upload / computer-vision body analysis in this version — deliberately skipped as unreliable and a liability risk. Body type is a manual self-select instead.
- Health conditions are passed to the model with an instruction to avoid contraindicated exercises and flag when a doctor should be consulted, but this is not medical advice — the UI carries an explicit disclaimer.
- Everything runs on Cloudflare's free tier (Pages, Pages Functions, D1, Workers AI within its free daily neuron allowance).
