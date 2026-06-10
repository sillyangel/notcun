const FIXED_USER_DOMAIN = "sillyangel.dev";

const state = {
	authenticated: false,
	userId: "",
	rooms: [],
	selectedRoomId: "",
	messages: [],
	composerDraft: "",
	roomsLoading: false,
	messageLoading: false,
	error: "",
	username: "",
};

const app = document.querySelector("#app");

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function normalizeUserId(value) {
	const trimmed = String(value || "").trim();
	if (!trimmed) return "";
	let localPart = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	if (localPart.includes(":")) {
		localPart = localPart.split(":")[0];
	}
	return `@${localPart}:${FIXED_USER_DOMAIN}`;
}

async function api(path, options = {}) {
	const response = await fetch(path, {
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...(options.headers || {}),
		},
		...options,
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Request failed");
	}
	return payload;
}

function renderAuthScreen() {
	return `
		<section class="auth-card">
			<div class="badge">Matrix proxy</div>
			<h1>notcun</h1>
			<p class="lede">A thin client that only renders the two latest rooms and fetches room data from the server.</p>
			<form id="login-form" class="form-grid">
				<label>
					<span>Username</span>
					<input name="username" type="text" placeholder="alice" value="${escapeHtml(state.username)}" required />
				</label>
				<label>
					<span>Password</span>
					<input name="password" type="password" placeholder="Password" required />
				</label>
				<p class="muted auth-note">The server is fixed to https://matrix.sillyangel.dev, and usernames resolve to @localpart:sillyangel.dev.</p>
				<button class="primary" type="submit">Sign in</button>
			</form>
			${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
		</section>
	`;
}

function renderSidebar() {
	return `
		<aside class="sidebar-panel">
			<div class="panel-header">
				<div>
					<p class="eyebrow">Signed in as</p>
					<strong>${escapeHtml(state.userId)}</strong>
				</div>
				<button id="sign-out" class="ghost">Sign out</button>
			</div>
			<div class="stack">
				<section>
					<h2>Latest rooms</h2>
					<p class="muted">Only the two newest joined rooms are loaded.</p>
					<div class="list">
						${state.roomsLoading ? `<p class="empty">Loading rooms…</p>` : ""}
						${state.rooms.length ? state.rooms.map((room) => `
							<button class="list-item ${room.roomId === state.selectedRoomId ? "active" : ""}" data-room-id="${escapeHtml(room.roomId)}">
								<span class="item-title">${escapeHtml(room.name)}</span>
								<span class="item-meta">${escapeHtml(room.preview || room.roomId)}</span>
							</button>
						`).join("") : `<p class="empty">No rooms available yet.</p>`}
					</div>
				</section>
			</div>
		</aside>
	`;
}

function renderMain() {
	const room = state.rooms.find((candidate) => candidate.roomId === state.selectedRoomId) || null;
	if (!room) {
		return `
			<section class="main-panel empty-state">
				<h2>Pick a room</h2>
				<p>The backend keeps the list down to two rooms, so this view stays small and quick to render.</p>
			</section>
		`;
	}

	return `
		<section class="main-panel">
			<header class="room-header">
				<div>
					<p class="eyebrow">Room</p>
					<h2>${escapeHtml(room.name)}</h2>
					<p class="muted">${escapeHtml(room.roomId)}</p>
				</div>
			</header>
			<div class="timeline">
				${state.messageLoading ? `<p class="empty">Loading messages…</p>` : ""}
				${state.messages.length ? state.messages.map((message) => `
					<article class="message">
						<header>
							<strong>${escapeHtml(message.sender)}</strong>
							<time>${escapeHtml(new Date(message.ts).toLocaleString())}</time>
						</header>
						<p>${escapeHtml(message.body)}</p>
					</article>
				`).join("") : `<p class="empty">No text messages are visible yet.</p>`}
			</div>
			<form id="composer" class="composer">
				<textarea name="message" rows="3" placeholder="Write a message" maxlength="4000">${escapeHtml(state.composerDraft)}</textarea>
				<div class="composer-actions">
					<p class="muted">Messages go through the server proxy, not directly from the browser.</p>
					<button class="primary" type="submit">Send</button>
				</div>
			</form>
		</section>
	`;
}

function renderApp() {
	if (!state.authenticated) {
		app.innerHTML = `<main class="shell auth-shell">${renderAuthScreen()}</main>`;
		bindAuthForm();
		return;
	}

	app.innerHTML = `
		<main class="shell">
			<section class="topbar">
				<div>
					<p class="eyebrow">notcun</p>
					<h1>Rooms only</h1>
				</div>
				<div class="status-pill">${escapeHtml(state.roomsLoading ? "syncing" : "ready")}</div>
			</section>
			<div class="workspace">
				${renderSidebar()}
				${renderMain()}
			</div>
		</main>
	`;
	bindWorkspaceHandlers();
}

function bindAuthForm() {
	const form = document.querySelector("#login-form");
	if (!form) return;

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const formData = new FormData(form);
		const username = normalizeUserId(formData.get("username"));
		const password = String(formData.get("password") || "");

		if (!username) {
			state.error = "Enter a username";
			renderApp();
			return;
		}

		state.error = "";
		state.roomsLoading = true;
		renderApp();

		try {
			await api("/api/login", {
				method: "POST",
				body: JSON.stringify({ username, password }),
			});
			state.username = username;
			state.authenticated = true;
			await refreshRooms(true);
		} catch (error) {
			state.roomsLoading = false;
			state.authenticated = false;
			state.error = error?.message || "Login failed";
			renderApp();
		}
	});
}

function bindWorkspaceHandlers() {
	document.querySelectorAll("[data-room-id]").forEach((button) => {
		button.addEventListener("click", () => {
			const roomId = button.getAttribute("data-room-id");
			if (roomId) selectRoom(roomId);
		});
	});

	const signOut = document.querySelector("#sign-out");
	if (signOut) {
		signOut.addEventListener("click", async () => {
			try {
				await api("/api/logout", { method: "POST" });
			} catch {
				// ignore logout errors
			}
			state.authenticated = false;
			state.userId = "";
			state.rooms = [];
			state.selectedRoomId = "";
			state.messages = [];
			state.composerDraft = "";
			renderApp();
		});
	}

	const composer = document.querySelector("#composer");
	if (composer) {
		const textarea = composer.querySelector('textarea[name="message"]');
		if (textarea) {
			textarea.addEventListener("input", () => {
				state.composerDraft = textarea.value;
			});
		}

		composer.addEventListener("submit", async (event) => {
			event.preventDefault();
			if (!state.selectedRoomId) return;
			const body = state.composerDraft.trim();
			if (!body) return;
			state.composerDraft = "";
			await api(`/api/rooms/${encodeURIComponent(state.selectedRoomId)}/messages`, {
				method: "POST",
				body: JSON.stringify({ body }),
			});
			await loadMessages(state.selectedRoomId);
		});
	}
}

function selectRoom(roomId) {
	state.selectedRoomId = roomId;
	state.composerDraft = "";
	renderApp();
	loadMessages(roomId);
}

async function refreshRooms(silent = false) {
	if (!silent) {
		state.roomsLoading = true;
		renderApp();
	}

	const payload = await api("/api/rooms");
	state.authenticated = true;
	state.userId = payload.userId || state.userId;
	state.rooms = payload.rooms || [];
	state.roomsLoading = Boolean(payload.loading);
	if (!state.selectedRoomId || !state.rooms.some((room) => room.roomId === state.selectedRoomId)) {
		state.selectedRoomId = state.rooms[0]?.roomId || "";
	}
	renderApp();

	if (payload.loading) {
		setTimeout(() => refreshRooms(true).catch(() => {}), 1200);
		return;
	}

	if (state.selectedRoomId) {
		await loadMessages(state.selectedRoomId, true);
	}
}

async function loadMessages(roomId, silent = false) {
	if (!silent) {
		state.messageLoading = true;
		renderApp();
	}

	const payload = await api(`/api/rooms/${encodeURIComponent(roomId)}/messages`);
	state.messages = payload.messages || [];
	state.messageLoading = false;
	renderApp();
}

async function boot() {
	try {
		const session = await api("/api/session");
		state.authenticated = Boolean(session.authenticated);
		state.userId = session.userId || "";
		state.username = session.username || "";
		renderApp();
		if (state.authenticated) {
			await refreshRooms();
			return;
		}
	} catch {
		state.authenticated = false;
	}
	renderApp();
}

boot();