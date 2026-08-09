# Grammar Mastery Frontend

Next.js 16 App Router implementation for Stage 22. Browser requests remain same-origin; the server boundary attaches the Stage 21 session token from an httpOnly cookie.

## Local setup

```bash
cp .env.example .env.local
npm ci
npm run api:generate
npm run dev
```

The Django API must be available at `DJANGO_API_BASE_URL`. Keep this variable server-only; never create a `NEXT_PUBLIC_` token or API-secret variable.

## Validation

```bash
npm run validate
```

Generated types come from `../api/stage21_core_api_spec_v1.0.yaml`. Do not hand-edit `src/lib/api/generated.ts`.
