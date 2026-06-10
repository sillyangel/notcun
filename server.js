import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as matrixSdk from "matrix-js-sdk";

const { createClient, EventType } = matrixSdk;

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const BASE_URL = "https://matrix.sillyangel.dev";
const USER_DOMAIN = "sillyangel.dev";

const sessions = new Map();

function normalizeUserId(value) {
	const trimmed = String(value || "").trim();
	if (!trimmed) return "";
	let localPart = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	if (localPart.includes(":")) {
		localPart = localPart.split(":")[0];
	}
	return `@${localPart}:${USER_DOMAIN}`;
}

function parseCookies(header = "") {
	return Object.fromEntries(
		header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
			const index = part.indexOf("=");
			if (index === -1) return [part, ""];
			return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
		}),
	);
}

function sendJson(response, statusCode, body) {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(body));
}

function sendText(response, statusCode, content, contentType = "text/plain; charset=utf-8") {
	response.writeHead(statusCode, {
		"Content-Type": contentType,
		"Cache-Control": "no-store",
	});
	response.end(content);
}

async function readJson(request) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(chunk);
	}
	if (!chunks.length) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getSession(request) {
	const cookies = parseCookies(request.headers.cookie || "");
	const sessionId = cookies.notcun_session;
	if (!sessionId) return null;
	return sessions.get(sessionId) || null;
}

async function ensureClientReady(session) {
	if (session.started) return;
	session.started = true;
	session.client = createClient({
		baseUrl: BASE_URL,
		accessToken: session.accessToken,
		userId: session.userId,
		deviceId: session.deviceId,
		timelineSupport: true,
		lazyLoadMembers: true,
	});
	session.syncState = "STARTING";
	session.client.on("sync", (syncState) => {
		session.syncState = syncState;
	});
	session.client.startClient({
		initialSyncLimit: 8,
		lazyLoadMembers: true,
		disablePresence: true,
	});
}

function isSpace(room) {
	const createEvent = room.currentState.getStateEvents(EventType.RoomCreate, "");
	const createType = createEvent?.getContent?.()?.type;
	return createType === "m.space" || room.currentState.getStateEvents(EventType.SpaceChild).length > 0;
}

function getLatestRooms(session) {
	const rooms = session.client
		.getRooms()
		.filter((room) => room.getMyMembership() === "join" && !isSpace(room))
		.sort((left, right) => {
			const rightTs = right.getLastActiveTimestamp?.() || 0;
			const leftTs = left.getLastActiveTimestamp?.() || 0;
			if (rightTs !== leftTs) return rightTs - leftTs;
			return (right.bumpStamp || 0) - (left.bumpStamp || 0);
		})
		.slice(0, 2);

	return rooms.map((room) => {
		const timeline = room.getLiveTimeline?.()?.getEvents?.() || [];
		const preview = [...timeline]
			.reverse()
			.find((event) => event.getType() === EventType.RoomMessage && event.getContent?.()?.body);

		return {
			roomId: room.roomId,
			name: room.name || room.getCanonicalAlias?.() || room.roomId,
			lastActiveTimestamp: room.getLastActiveTimestamp?.() || 0,
			preview: preview?.getContent?.()?.body || "",
		};
	});
}

function getRoomMessages(session, roomId, limit = 20) {
	const room = session.client.getRoom(roomId);
	if (!room) return [];
	const timeline = room.getLiveTimeline?.()?.getEvents?.() || [];
	return timeline
		.filter((event) => event.getType() === EventType.RoomMessage)
		.filter((event) => {
			const content = event.getContent?.() || {};
			return typeof content.body === "string";
		})
		.slice(-limit)
		.map((event) => {
			const content = event.getContent?.() || {};
			return {
				sender: event.getSender?.() || event.sender?.userId || "Unknown",
				ts: event.getTs?.() || Date.now(),
				body: content.body || "",
			};
		});
}

async function handleLogin(request, response) {
	const body = await readJson(request);
	const username = normalizeUserId(body.username);
	const password = String(body.password || "");

	if (!username || !password) {
		sendJson(response, 400, { error: "Username and password are required" });
		return;
	}

	const tempClient = createClient({ baseUrl: BASE_URL });
	const login = await tempClient.loginWithPassword(username, password);
	const sessionId = crypto.randomUUID();
	const session = {
		id: sessionId,
		userId: login.user_id,
		accessToken: login.access_token,
		deviceId: login.device_id,
		username,
		client: null,
		syncState: "STARTING",
		started: false,
	};
	sessions.set(sessionId, session);
	await ensureClientReady(session);
	response.setHeader("Set-Cookie", `notcun_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`);
	sendJson(response, 200, { authenticated: true, userId: session.userId });
}

async function handleRooms(request, response) {
	const session = getSession(request);
	if (!session) {
		sendJson(response, 401, { error: "Not authenticated" });
		return;
	}
	await ensureClientReady(session);
	const ready = session.syncState === "PREPARED" || session.syncState === "SYNCING";
	sendJson(response, 200, {
		userId: session.userId,
		loading: !ready,
		rooms: ready ? getLatestRooms(session) : [],
	});
}

async function handleMessages(request, response, roomId) {
	const session = getSession(request);
	if (!session) {
		sendJson(response, 401, { error: "Not authenticated" });
		return;
	}
	await ensureClientReady(session);
	if (request.method === "POST") {
		const body = await readJson(request);
		const message = String(body.body || "").trim();
		if (!message) {
			sendJson(response, 400, { error: "Message body is required" });
			return;
		}
		await session.client.sendTextMessage(roomId, message);
		sendJson(response, 200, { ok: true });
		return;
	}
	sendJson(response, 200, { messages: getRoomMessages(session, roomId) });
}

async function handleSession(request, response) {
	const session = getSession(request);
	if (!session) {
		sendJson(response, 200, { authenticated: false });
		return;
	}
	sendJson(response, 200, {
		authenticated: true,
		userId: session.userId,
		username: session.username,
		syncState: session.syncState,
	});
}

async function handleLogout(request, response) {
	const session = getSession(request);
	if (session?.client) {
		session.client.stopClient();
	}
	const cookies = parseCookies(request.headers.cookie || "");
	if (cookies.notcun_session) {
		sessions.delete(cookies.notcun_session);
	}
	response.setHeader("Set-Cookie", "notcun_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
	sendJson(response, 200, { ok: true });
}

async function serveStatic(response, pathname) {
	const cleanPath = pathname === "/" ? "/index.html" : pathname;
	const filePath = path.resolve(ROOT, `.${cleanPath}`);
	if (!filePath.startsWith(ROOT)) {
		sendText(response, 403, "Forbidden");
		return;
	}
	const contentType = filePath.endsWith(".html")
		? "text/html; charset=utf-8"
		: filePath.endsWith(".js")
			? "text/javascript; charset=utf-8"
			: filePath.endsWith(".css")
				? "text/css; charset=utf-8"
				: "application/octet-stream";
	response.writeHead(200, {
		"Content-Type": contentType,
		"Cache-Control": "no-store",
	});
	createReadStream(filePath).on("error", () => sendText(response, 404, "Not found")).pipe(response);
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
	const { pathname } = url;

	try {
		if (request.method === "POST" && pathname === "/api/login") {
			await handleLogin(request, response);
			return;
		}
		if (request.method === "GET" && pathname === "/api/session") {
			await handleSession(request, response);
			return;
		}
		if (request.method === "GET" && pathname === "/api/rooms") {
			await handleRooms(request, response);
			return;
		}
		if (pathname.startsWith("/api/rooms/") && pathname.endsWith("/messages")) {
			const roomId = decodeURIComponent(pathname.slice("/api/rooms/".length, -"/messages".length));
			await handleMessages(request, response, roomId);
			return;
		}
		if (request.method === "POST" && pathname === "/api/logout") {
			await handleLogout(request, response);
			return;
		}
		await serveStatic(response, pathname);
	} catch (error) {
		sendJson(response, 500, { error: error?.message || "Server error" });
	}
});

server.listen(PORT, () => {
	console.log(`notcun proxy listening on http://localhost:${PORT}`);
});