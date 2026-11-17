const ALLOWED_ORIGINS = Object.freeze([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://fastshop-id.vercel.app",
  "https://admin-fastshop.netlify.app",
]);

const isAllowedOrigin = (origin) =>
  typeof origin === "string" && ALLOWED_ORIGINS.includes(origin);

module.exports = {
  ALLOWED_ORIGINS,
  isAllowedOrigin,
};
