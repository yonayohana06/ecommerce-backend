const INVALID_CREDENTIALS_MESSAGE = "Kredensial tidak valid.";
const BCRYPT_MAX_BYTES = 72;

const USER_REFRESH_COOKIE = "fastshop_user_refresh";
const ADMIN_REFRESH_COOKIE = "fastshop_admin_refresh";
const REFRESH_COOKIE_PATHS = Object.freeze({
  user: "/api/auth",
  admin: "/api/admin/auth",
});
const REFRESH_PORTALS = Object.freeze(["user", "admin"]);

module.exports = {
  INVALID_CREDENTIALS_MESSAGE,
  BCRYPT_MAX_BYTES,
  USER_REFRESH_COOKIE,
  ADMIN_REFRESH_COOKIE,
  REFRESH_COOKIE_PATHS,
  REFRESH_PORTALS,
};
