
# notcun

small matrix client

## Run locally

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite, then sign in with your Matrix homeserver URL, username, and password.

## Production build

```bash
pnpm build
pnpm preview
```

## Docker

Build the image:

```bash
docker build -t notcun .
```

Run it:

```bash
docker run --rm -p 8080:80 notcun
```

Then open `http://localhost:8080`.

## Published image

When the GitHub Actions workflow runs on `main`, it publishes the image to GitHub Container Registry as `ghcr.io/sillyangel/notcun:latest` and `ghcr.io/sillyangel/notcun:<commit-sha>`.
