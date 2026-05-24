# Chipmates Rummy

A mobile-friendly Rummy score tracking app with:

- Player setup
- Point limit selection
- Round-by-round score entry
- Live standings and round history
- Shareable scorecard links

## Run locally

```bash
node server.js
```

Open:

```text
http://localhost:4173
```

## Sharing

Use the **Share link** button after saving scores. When running through `node server.js`, the app creates a room link so players can open the same scorecard and see updates as new rounds are saved.

For public sharing outside your local network, deploy this app to a small Node host such as Render, Railway, Fly.io, or a similar service.
