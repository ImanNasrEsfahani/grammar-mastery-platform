# Apply instructions

Patch base audited: `main` at `d4f0d685ab7cea3ceb4e0aa5137ccf2bce57b1f3`.

Copy the contents of `repository_payload/` onto the repository root and commit them through your normal GitHub workflow. This package does not commit or push anything itself.

After the change is on `main`, on the server run:

```bash
cd /var/www/grammar-mastery
git pull --ff-only origin main

docker compose --env-file .env.docker build --pull backend
docker compose --env-file .env.docker up -d backend
```

Then, because the current database already has the Stage12 schema/reference state, run the Question Bank command directly:

```bash
docker compose --env-file .env.docker exec -T backend \
  python ops/question_bank/bootstrap.py \
  --publish-reviewed \
  --reviewer-external-id iman-reviewer-v1.0 \
  --confirm-human-review
```

Success for the currently loaded B001-B041 / L01-L09 master is shown by `database_status_counts.PUBLISHED = 1806` and `database_status_counts.SERVING = 1806`.

Do not run `docker compose down -v`. PostgreSQL uses the persistent `postgres_data` volume and must not be rebuilt from zero on normal deploys.
