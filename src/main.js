import * as matrixSdk from "matrix-js-sdk";

const { createClient, EventType } = matrixSdk;

const STORAGE_KEY = "notcun.matrix.session";
const FIXED_BASE_URL = "https://matrix.sillyangel.dev";
const FIXED_USER_DOMAIN = "sillyangel.dev";

const state = {
	client: null,
	auth: loadSession(),
	syncState: "idle",
	error: "",
	rooms: [],
	selectedRoomId: "",
	composerDraft: "",
	loadingTimeline: false,
};

const app = document.querySelector("#app");

function loadSession() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function saveSession(session) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
	localStorage.removeItem(STORAGE_KEY);
}

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

	let localPart = trimmed;
	if (localPart.startsWith("@")) {
		localPart = localPart.slice(1);
	}
	if (localPart.includes(":")) {
		localPart = localPart.split(":")[0];
	}

	return `@${localPart}:${FIXED_USER_DOMAIN}`;
}

function getRoomName(room) {
	return room?.name?.trim() || room?.getCanonicalAlias?.() || room?.roomId || "Unknown room";
}

function isSpace(room) {
	const createEvent = room.currentState.getStateEvents(EventType.RoomCreate, "");
	const createType = createEvent?.getContent?.()?.type;
	return createType === "m.space" || room.currentState.getStateEvents(EventType.SpaceChild).length > 0;
}

function getJoinedRooms() {
	if (!state.client) return [];
	return state.client
		.getRooms()
		.filter((room) => room.getMyMembership() === "join")
		.sort((left, right) => getRoomName(left).localeCompare(getRoomName(right)));
}

function getSpaceChildren(spaceRoom) {
	const childEvents = spaceRoom.currentState.getStateEvents(EventType.SpaceChild);
	const roomMap = new Map(state.rooms.map((room) => [room.roomId, room]));

	return childEvents
		.map((event) => {
			const roomId = event.getStateKey();
			const room = roomMap.get(roomId);
			if (!room) return null;
			return {
				room,
				order: event.getContent?.()?.order || getRoomName(room).toLowerCase(),
			};
		})
		.filter(Boolean)
		.sort((left, right) => String(left.order).localeCompare(String(right.order)));
}

function getRoomTimeline(room) {
	const events = room?.getLiveTimeline?.()?.getEvents?.() || [];
	return events.filter((event) => {
		if (event.getType() !== EventType.RoomMessage) return false;
		const content = event.getContent?.() || {};
		return content.msgtype === "m.text" || typeof content.body === "string";
	});
}

function selectRoom(roomId) {
	state.selectedRoomId = roomId;
	state.composerDraft = "";
	render();
}

function renderAuthScreen() {
	return `
		<section class="auth-card">
			<div class="badge">Matrix client</div>
			<h1>notcun</h1>
			<p class="lede">A lightweight Matrix client for rooms and spaces. No calling, no voice, no encryption UI.</p>
			<form id="login-form" class="form-grid">
				<label>
					<span>Username</span>
					<input name="username" type="text" placeholder="alice" value="${escapeHtml(state.auth?.username || "")}" required />
				</label>
				<label>
					<span>Password</span>
					<input name="password" type="password" placeholder="Password" required />
				</label>
				<p class="muted auth-note">The client is locked to ${escapeHtml(FIXED_BASE_URL)} and all users are resolved as @localpart:${escapeHtml(FIXED_USER_DOMAIN)}.</p>
				<button class="primary" type="submit">Sign in</button>
			</form>
			${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
		</section>
	`;
}

function renderSidebar() {
	const spaces = state.rooms.filter(isSpace);
	const regularRooms = state.rooms.filter((room) => !isSpace(room));

	return `
		<aside class="sidebar-panel">
			<div class="panel-header">
				<div>
					<p class="eyebrow">Signed in as</p>
					<strong>${escapeHtml(state.auth?.userId || "")}</strong>
				</div>
				<button id="sign-out" class="ghost">Sign out</button>
			</div>
			<div class="stack">
				<section>
					<h2>Rooms</h2>
					<div class="list">
						${regularRooms.length ? regularRooms.map((room) => {
							const active = room.roomId === state.selectedRoomId ? "active" : "";
							return `
								<button class="list-item ${active}" data-room-id="${escapeHtml(room.roomId)}">
									<span class="item-title">${escapeHtml(getRoomName(room))}</span>
									<span class="item-meta">${escapeHtml(room.roomId)}</span>
								</button>
							`;
						}).join("") : `<p class="empty">No joined rooms yet.</p>`}
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
				<h2>Pick a room or space</h2>
				<p>Select any joined room from the sidebar. Space rooms will show their child rooms, and normal rooms will show a live timeline with a plain text composer.</p>
			</section>
		`;
	}

	if (isSpace(room)) {
		const children = getSpaceChildren(room);
		return `
			<section class="main-panel">
				<header class="room-header">
					<div>
						<p class="eyebrow">Space</p>
						<h2>${escapeHtml(getRoomName(room))}</h2>
						<p class="muted">${escapeHtml(room.roomId)}</p>
					</div>
				</header>
				<div class="space-grid">
					<section>
						<h3>Child rooms</h3>
						<div class="list">
							${children.length ? children.map(({ room: childRoom }) => `
								<button class="list-item ${childRoom.roomId === state.selectedRoomId ? "active" : ""}" data-room-id="${escapeHtml(childRoom.roomId)}">
									<span class="item-title">${escapeHtml(getRoomName(childRoom))}</span>
									<span class="item-meta">${escapeHtml(childRoom.roomId)}</span>
								</button>
							`).join("") : `<p class="empty">This space does not expose any joined child rooms yet.</p>`}
						</div>
					</section>
				</div>
			</section>
		`;
	}

	const timeline = getRoomTimeline(room);
	return `
		<section class="main-panel">
			<header class="room-header">
				<div>
					<p class="eyebrow">Room</p>
					<h2>${escapeHtml(getRoomName(room))}</h2>
					<p class="muted">${escapeHtml(room.roomId)}</p>
				</div>
			</header>
			<div class="timeline">
				${state.loadingTimeline ? `<p class="empty">Loading timeline…</p>` : ""}
				${timeline.length ? timeline.map((event) => {
					const content = event.getContent?.() || {};
					return `
						<article class="message">
							<header>
								<strong>${escapeHtml(event.getSender?.() || event.sender?.userId || "Unknown")}</strong>
								<time>${escapeHtml(new Date(event.getTs?.() || Date.now()).toLocaleString())}</time>
							</header>
							<p>${escapeHtml(content.body || "")}</p>
						</article>
					`;
				}).join("") : `<p class="empty">No text messages are visible yet.</p>`}
			</div>
			<form id="composer" class="composer">
				<textarea name="message" rows="3" placeholder="Write a message" maxlength="4000">${escapeHtml(state.composerDraft)}</textarea>
				<div class="composer-actions">
					<p class="muted">Plain text only. Encrypted rooms are intentionally not surfaced.</p>
					<button class="primary" type="submit">Send</button>
				</div>
			</form>
		</section>
	`;
}

function renderApp() {
	if (!state.auth || !state.client) {
		app.innerHTML = `<main class="shell auth-shell">${renderAuthScreen()}</main>`;
		bindAuthForm();
		return;
	}

	app.innerHTML = `
		<main class="shell">
			<section class="topbar">
				<div>
					<p class="eyebrow">notcun</p>
					<h1>Rooms and spaces</h1>
				</div>
				<div class="status-pill">${escapeHtml(state.syncState)}</div>
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
		const baseUrl = FIXED_BASE_URL;

		if (!username) {
			state.error = "Enter a username";
			renderApp();
			return;
		}

		state.error = "";
		state.syncState = "logging in";
		renderApp();

		try {
			const tempClient = createClient({ baseUrl });
			const response = await tempClient.loginWithPassword(username, password);
			state.auth = {
				baseUrl,
				userId: response.user_id,
				accessToken: response.access_token,
				deviceId: response.device_id,
				username,
			};
			saveSession(state.auth);
			await bootClient();
		} catch (error) {
			state.syncState = "idle";
			state.error = error?.message || "Login failed";
			state.auth = null;
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
		signOut.addEventListener("click", () => {
			if (state.client) {
				state.client.stopClient();
			}
			state.client = null;
			state.auth = null;
			state.rooms = [];
			state.selectedRoomId = "";
			state.syncState = "idle";
			clearSession();
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
			if (!state.client || !state.selectedRoomId) return;
			const body = state.composerDraft.trim();
			if (!body) return;
			state.composerDraft = "";
			await state.client.sendTextMessage(state.selectedRoomId, body);
			renderApp();
		});
	}
}

async function refreshRooms() {
	if (!state.client) return;
	state.rooms = getJoinedRooms();
	if (!state.selectedRoomId || !state.rooms.some((room) => room.roomId === state.selectedRoomId)) {
		state.selectedRoomId = state.rooms[0]?.roomId || "";
	}
	renderApp();
}

async function bootClient() {
	if (!state.auth) return;
	state.error = "";
	state.client = createClient({
		baseUrl: state.auth.baseUrl,
		accessToken: state.auth.accessToken,
		userId: state.auth.userId,
		deviceId: state.auth.deviceId,
		timelineSupport: true,
	});

	state.client.on("sync", async (syncState) => {
		state.syncState = syncState.toLowerCase();
		if (syncState === "PREPARED" || syncState === "SYNCING") {
			await refreshRooms();
			return;
		}
		renderApp();
	});

	state.client.on("Room", () => {
		refreshRooms();
	});

	state.client.on("Room.timeline", (_event, room) => {
		if (room?.roomId === state.selectedRoomId) {
			renderApp();
		}
	});

	state.client.startClient({ initialSyncLimit: 20 });
	state.syncState = "starting";
	renderApp();
}

function restoreSession() {
	if (!state.auth?.accessToken || !state.auth?.userId) {
		state.auth = null;
		return;
	}
	state.auth.baseUrl = FIXED_BASE_URL;
	bootClient();
}

renderApp();
restoreSession();