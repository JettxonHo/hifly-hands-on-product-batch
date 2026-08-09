const PUBLIC_AUTH_ROUTES = new Set([
  "GET /api/auth/intent",
  "POST /api/auth/login",
  "POST /api/auth/change-password"
]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PASSWORD_CHANGE_ROUTES = new Set(["GET /api/auth/me", "POST /api/auth/logout"]);

function routeKey(request) {
  return `${request.method} ${request.url.split("?", 1)[0]}`;
}

function sendError(reply, error) {
  const code = error?.code || "INTERNAL_ERROR";
  const status = {
    AUTH_REQUIRED: 401,
    AUTH_INTENT_REQUIRED: 401,
    AUTH_INVALID_CREDENTIALS: 401,
    ACCOUNT_UNAVAILABLE: 403,
    ADMIN_REQUIRED: 403,
    CSRF_REQUIRED: 403,
    PASSWORD_CHANGE_SESSION_REQUIRED: 403,
    PASSWORD_CHANGE_REQUIRED: 403,
    NO_ACTIVE_MEMBERSHIP: 403,
    AUTH_RATE_LIMITED: 429,
    PASSWORD_TOO_WEAK: 400,
    INVALID_MEMBER_PAYLOAD: 400,
    INVALID_CHANGE_PASSWORD_PAYLOAD: 400,
    INVALID_LOGIN_PAYLOAD: 400,
    INVALID_MEMBER_REVISION: 400,
    PASSWORD_MUST_DIFFER: 409,
    MEMBER_EMAIL_CONFLICT: 409,
    MEMBER_VERSION_CONFLICT: 409,
    AUTH_INTENT_CONFLICT: 409,
    MEMBER_NOT_FOUND: 404
  }[code] ?? 500;
  reply.code(status).send({ error: status === 500 ? "INTERNAL_ERROR" : code });
}

function publicContext(authService, context) {
  return {
    member: authService.safeMember(context.member, context.membership),
    membership: {
      id: context.membership.id,
      role: context.membership.role,
      status: context.membership.status
    },
    organization: { id: context.organization.id, name: context.organization.name }
  };
}

function sessionToken(authService, request) {
  return authService.readSessionCookie(request.headers.cookie);
}

export async function registerAuthRoutes(app, { authService }) {
  app.get("/api/auth/intent", async (_request, reply) => {
    const result = await authService.createIntent();
    reply.header("Set-Cookie", result.cookies);
    reply.send({ status: "ready", csrf_token: result.csrfToken, csrf_header: authService.csrfHeaderName });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") return sendError(reply, { code: "INVALID_LOGIN_PAYLOAD" });
    try {
      const result = await authService.login(sessionToken(authService, request), email, password, { clientKey: request.ip });
      reply.send({ status: result.status, ...publicContext(authService, result.context) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/auth/change-password", async (request, reply) => {
    const { new_password } = request.body ?? {};
    if (typeof new_password !== "string") return sendError(reply, { code: "INVALID_CHANGE_PASSWORD_PAYLOAD" });
    try {
      const result = await authService.changePassword(sessionToken(authService, request), new_password);
      reply.send({ status: "ok", ...publicContext(authService, result.context) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await authService.logout(sessionToken(authService, request));
    reply.header("Set-Cookie", authService.clearCookies());
    reply.send({ status: "ok" });
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.identity) return sendError(reply, { code: "AUTH_REQUIRED" });
    if (request.identity.session.intent === "password_change") {
      return reply.send({ status: "password_change_required" });
    }
    reply.send({ status: "ok", ...publicContext(authService, request.identity) });
  });

  app.get("/api/identity/members", async (request, reply) => {
    try {
      reply.send({ members: await authService.listMembers(request.identity) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/identity/members", async (request, reply) => {
    try {
      const result = await authService.createMember(request.identity, {
        email: request.body?.email,
        displayName: request.body?.display_name,
        role: request.body?.role
      });
      reply.code(201).send(result);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/identity/members/:memberId/disable", async (request, reply) => {
    const expectedRevision = Number(request.body?.expected_revision);
    if (!Number.isInteger(expectedRevision)) return sendError(reply, { code: "INVALID_MEMBER_REVISION" });
    try {
      reply.send({ member: await authService.disableMember(request.identity, request.params.memberId, expectedRevision) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/identity/members/:memberId/reset-password", async (request, reply) => {
    const expectedRevision = Number(request.body?.expected_revision);
    if (!Number.isInteger(expectedRevision)) return sendError(reply, { code: "INVALID_MEMBER_REVISION" });
    try {
      reply.send(await authService.resetMemberPassword(request.identity, request.params.memberId, expectedRevision));
    } catch (error) {
      sendError(reply, error);
    }
  });
}

export function createIdentityGuard(authService) {
  return async function identityGuard(request, reply) {
    const key = routeKey(request);
    const path = request.url.split("?", 1)[0];
    if (!path.startsWith("/api/")) return;
    if (path.startsWith("/api/agent/v1/")) return;
    const token = sessionToken(authService, request);

    if (!SAFE_METHODS.has(request.method)) {
      try {
        await authService.verifyCsrf(token, request.headers[authService.csrfHeaderName]);
      } catch (error) {
        return sendError(reply, error);
      }
    }
    if (PUBLIC_AUTH_ROUTES.has(key)) return;

    const context = await authService.resolveContext(token);
    if (!context) return sendError(reply, { code: "AUTH_REQUIRED" });
    if (context.session.intent === "password_change" && !PASSWORD_CHANGE_ROUTES.has(key)) {
      return sendError(reply, { code: "PASSWORD_CHANGE_REQUIRED" });
    }
    request.identity = context;
  };
}

export { PUBLIC_AUTH_ROUTES };
