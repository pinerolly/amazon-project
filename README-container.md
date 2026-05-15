# Container deployment

Build the image:

```bash
docker build -t amazon-project:latest .
```

Run with Docker:

```bash
docker run --env-file .env -p 3000:3000 -v $(pwd)/auth.json:/usr/src/app/auth.json:ro --restart unless-stopped amazon-project:latest
```

Or use docker-compose:

```bash
docker compose up -d --build
```

Notes:
- The image is based on Playwright's official image, which includes browser binaries and dependencies.
- For production, set `HEADLESS=true` in your `.env` so browsers run headless inside the container.
- Keep `.env` and `auth.json` out of your git repo; mount them at runtime as shown above.
