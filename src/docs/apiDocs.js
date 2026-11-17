const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");

const SPEC_PATH = path.resolve(__dirname, "../../docs/openapi.yaml");

const DOCS_CSP_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
});

// Dokumentasi hanya untuk lingkungan pengembangan/test. Production tidak
// memasang route ini sama sekali, sehingga spec dan Swagger UI tidak terekspos.
const isApiDocsEnabled = ({ nodeEnv = process.env.NODE_ENV } = {}) =>
  nodeEnv !== "production";

const createApiDocsRouter = () => {
  // Lazy require: dependency ini devDependency dan tidak boleh dibutuhkan saat
  // production menjalankan aplikasi tanpa devDependencies.
  const YAML = require("yaml");
  const swaggerUi = require("swagger-ui-express");

  const rawSpec = fs.readFileSync(SPEC_PATH, "utf8");
  const spec = YAML.parse(rawSpec);

  const router = express.Router();

  // Helmet global sudah memasang CSP sebelum router ini. Browser menggabungkan
  // beberapa header CSP, jadi header global harus dibuang agar policy docs
  // (yang membutuhkan inline script Swagger UI) benar-benar berlaku.
  router.use((req, res, next) => {
    res.removeHeader("Content-Security-Policy");
    next();
  });

  router.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: DOCS_CSP_DIRECTIVES,
      },
    }),
  );

  router.get("/openapi.yaml", (req, res) => {
    return res.type("text/yaml").send(rawSpec);
  });

  router.get("/openapi.json", (req, res) => {
    return res.json(spec);
  });

  router.use(
    "/",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "FastShop API Docs",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
      },
    }),
  );

  return router;
};

module.exports = {
  SPEC_PATH,
  DOCS_CSP_DIRECTIVES,
  isApiDocsEnabled,
  createApiDocsRouter,
};
