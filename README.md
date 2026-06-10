
# notcun

small matrix client

The app is proxy-backed now. The browser only renders a thin UI, while the server handles Matrix login, room listing, and message fetch/send.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, then sign in with your Matrix username and password. The server is fixed to `https://matrix.sillyangel.dev`, and usernames resolve to `@localpart:sillyangel.dev`.

## Check syntax

```bash
pnpm build
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

## Compose

Start it with Docker Compose:

```bash
docker compose up --build
```

Then open `http://localhost:8080`.

## Published image

When the GitHub Actions workflow runs on `main`, it publishes the image to GitHub Container Registry as `ghcr.io/sillyangel/notcun:latest` and `ghcr.io/sillyangel/notcun:<commit-sha>`.
