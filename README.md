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

Use the **Share link** button after saving scores. The app creates a Supabase-backed link like:

```text
https://your-site.com/?gameId=...
```

Players can refresh the same link to load the latest scores.

## Supabase setup

Create this table:

```sql
create table games (
  id uuid primary key default gen_random_uuid(),
  state_json jsonb not null,
  updated_at timestamptz default now()
);
```

Allow app access:

```sql
alter table games enable row level security;

create policy "Anyone can read games" on games for select using (true);
create policy "Anyone can create games" on games for insert with check (true);
create policy "Anyone can update games" on games for update using (true);
```

For public sharing, deploy the static files to Cloudflare Pages, GitHub Pages, or another static host.
