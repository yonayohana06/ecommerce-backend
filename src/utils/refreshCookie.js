const cookie = require("cookie");

const {
  USER_REFRESH_COOKIE,
  ADMIN_REFRESH_COOKIE,
  REFRESH_COOKIE_PATHS,
  REFRESH_PORTALS,
} = require("../constants/auth");

const SAME_SITE_VALUES = ["strict", "lax", "none"];

const parseBoolean = (value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;

  return undefined;
};

const parseSameSite = (value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  return SAME_SITE_VALUES.includes(normalized) ? normalized : undefined;
};

const resolveRefreshCookieSettings = ({ portal, env = process.env }) => {
  if (!REFRESH_PORTALS.includes(portal)) {
    throw new Error(`Portal refresh token tidak dikenal: ${portal}`);
  }

  const isProduction = env.NODE_ENV === "production";
  const secure = parseBoolean(env.COOKIE_SECURE) ?? isProduction;
  const sameSite =
    parseSameSite(env.COOKIE_SAME_SITE) ?? (isProduction ? "none" : "lax");

  return {
    name:
      portal === "user" ? USER_REFRESH_COOKIE : ADMIN_REFRESH_COOKIE,
    path: REFRESH_COOKIE_PATHS[portal],
    httpOnly: true,
    secure,
    sameSite,
  };
};

const setRefreshCookie = (res, { portal, token, expiresAt, env }) => {
  const { name, ...options } = resolveRefreshCookieSettings({ portal, env });
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());

  res.cookie(name, token, { ...options, maxAge });
};

const clearRefreshCookie = (res, { portal, env }) => {
  const { name, ...options } = resolveRefreshCookieSettings({ portal, env });

  res.clearCookie(name, options);
};

const readRefreshCookie = (req, { portal }) => {
  const settings = resolveRefreshCookieSettings({ portal });
  const parsed = cookie.parse(req.headers.cookie || "");

  return parsed[settings.name] ?? null;
};

module.exports = {
  resolveRefreshCookieSettings,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
};
