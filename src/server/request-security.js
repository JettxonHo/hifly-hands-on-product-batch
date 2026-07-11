import { randomBytes, timingSafeEqual } from "node:crypto";

export const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'";
export const SESSION_COOKIE_NAME = "hifly_local_session";
export const SESSION_HEADER_NAME = "x-local-session-token";

function readCookie(header, name) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function parseHost(host) {
  if (typeof host !== "string") return null;
  const match = /^127\.0\.0\.1(?::([1-9]\d{0,4}))?$/.exec(host);
  if (!match) return null;
  if (!match[1]) return { hostname: "127.0.0.1", port: null, value: host };
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname: "127.0.0.1", port, value: host };
}

function validOrigin(host, origin) {
  return typeof origin === "string" && origin !== "null" && origin === `http://${host}`;
}

function validContentType(contentType) {
  if (typeof contentType !== "string") return false;
  const [type, ...parameters] = contentType.split(";").map((part) => part.trim().toLowerCase());
  if (type === "application/json") {
    return parameters.length === 0 || parameters.every((parameter) => parameter === "charset=utf-8");
  }
  return type === "multipart/form-data" && parameters.some((parameter) => parameter.startsWith("boundary="));
}

function tokensMatch(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftValue = Buffer.from(left);
  const rightValue = Buffer.from(right);
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function reject(reply, statusCode, code) {
  reply.code(statusCode).send({ error: code });
}

export function createRequestSecurity({ allowedHost = null } = {}) {
  const token = randomBytes(32).toString("base64url");

  function bootstrap(reply) {
    reply.header(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`
    );
    return { token, headerName: SESSION_HEADER_NAME };
  }

  function onRequest(request, reply, done) {
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("Cache-Control", "no-store");

    const host = request.headers.host;
    const parsedHost = parseHost(host);
    if (!parsedHost || (allowedHost && host !== allowedHost)) {
      reject(reply, 403, "LOCAL_HOST_REQUIRED");
      return;
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !validOrigin(host, origin)) {
      reject(reply, 403, "SAME_ORIGIN_REQUIRED");
      return;
    }

    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      done();
      return;
    }

    if (!validOrigin(host, origin)) {
      reject(reply, 403, "SAME_ORIGIN_REQUIRED");
      return;
    }
    if (!validContentType(request.headers["content-type"])) {
      reject(reply, 415, "JSON_OR_MULTIPART_REQUIRED");
      return;
    }

    const cookie = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const headerToken = request.headers[SESSION_HEADER_NAME] ?? request.headers["x-csrf-token"];
    if (!tokensMatch(cookie, token) || !tokensMatch(headerToken, token)) {
      reject(reply, 403, "SESSION_PROOF_REQUIRED");
      return;
    }
    done();
  }

  return { bootstrap, onRequest };
}
