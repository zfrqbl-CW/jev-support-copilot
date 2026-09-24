# jev-support-copilot

A live support reply co-pilot built on TypeSafe AI's Jev model, evaluating
tone, commitment risk, escalation, and predicted satisfaction in one
parallel call while you type. Deployed on Cloudways Velocity.

Built for a HackerNoon article on running Jev in production, not just
testing it in a playground.

## What it does

While a support agent types a reply, the app sends the draft to Jev over an
open WebSocket connection and asks four typed questions in a single call:

- **Tone** (Choice): empathetic, neutral, curt, or defensive
- **Unguaranteed commitment** (Noul): does the draft promise a specific
  refund amount, replacement, or timeline the company may not be able to
  guarantee
- **Needs manager review** (Noul): should this go past the agent before it
  sends
- **Predicted satisfaction** (Score): how the customer is likely to react

All four are evaluated in parallel against the same state, in one request,
the pattern TypeSafe's own docs recommend over separate calls per question.

Two live numbers track how fast that loop actually is: the time inside the
Jev call itself, and the full round trip from keystroke pause to answer on
screen. The gap between them is what your own hosting is responsible for,
Jev's own response time isn't.

## Run it locally

```sh
npm install
cp .env.example .env
```

Add your key to `.env`:

```
TYPESAFE_API_KEY=your-key-here
```

Then:

```sh
npm start
```

Open `http://localhost:3000`.

### No API key yet

The app runs in mock mode automatically if `TYPESAFE_API_KEY` is missing, so
you can build and screenshot the UI before you have access. Mock answers are
deterministic placeholders based on a hash of the draft text and a simple
keyword check, not real model output, tone in particular is not
semantically aware in mock mode. Set `TYPESAFE_API_KEY` and confirm the
console does not print the mock mode warning before capturing any screenshot
or timing number for the article.

## The cache, and why it needs to handle in-flight calls

Repeated identical evaluations are wasted cost and latency, so each
WebSocket connection keeps a small in-memory cache of the last draft it
evaluated. If the exact same text comes in again, the server returns the
stored result instead of calling Jev a second time.

The part that's easy to get wrong: a real API call takes real time. If a
second request for identical text arrives while the first one is still
waiting on Jev, a naive cache (checking only against the last *settled*
result) will miss and fire a redundant second call, and if that second call
happens to resolve with slightly different values (real model variance),
two requests for the same text can come back with two different answers.
This app tracks in-flight calls as a separate state from settled ones, so a
second identical request while the first is still running joins that same
pending call instead of starting its own. Both resolve to the exact same
result by construction.

## Project layout

```
server.js          Express static server + WebSocket handler: settled
                    cache, in-flight cache, error handling
lib/typesafe.js     The Jev integration: the four typed questions, and the
                    mock fallback
public/index.html   Markup: the document panel and the instrument rail
public/styles.css   Styling for both panels
public/app.js       Debounce, WebSocket client, badge and latency rendering
.env.example        Documents the required environment variables. The
                    real key is never committed, see .gitignore
```

## Deploying to Cloudways Velocity

1. Push this repo to GitHub. `.gitignore` keeps `node_modules` and any real
   `.env` file out of version control, only `.env.example` is committed.
2. In Velocity, create a new application and connect the repository and
   branch. Velocity detects the Node/Express setup from `package.json` on
   its own.
3. Under App Settings, add an environment variable `TYPESAFE_API_KEY` with
   your real key, and redeploy so it takes effect. The key lives only in
   Velocity's environment variables, never in the repo.
4. Open the live URL. Both latency readouts should stay close together,
   since nothing sits between the browser's WebSocket connection and the
   Jev call but this server.

## What to expect from real Jev calls

Per TypeSafe's docs, most calls complete in roughly 70 to 500 milliseconds.
The very first call your process makes will likely be slower than that,
in testing this app saw the first call take several seconds before
settling into the expected range on every call after. That's consistent
with a one-time connection warmup cost, not the ongoing baseline, worth
confirming with your own timing before drawing conclusions from a single
data point.
