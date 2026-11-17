const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const authRoutes = require("../../src/routes/authRoutes");
const orderRoutes = require("../../src/routes/orderRoutes");
const cartRoutes = require("../../src/routes/cartRoutes");
const paymentRoutes = require("../../src/routes/paymentRoutes");
const productRoutes = require("../../src/routes/productRoutes");
const categoryRoutes = require("../../src/routes/categoryRoutes");
const adminProductRoutes = require("../../src/routes/adminProductRoutes");
const adminCategoryRoutes = require("../../src/routes/adminCategoryRoutes");
const adminAuditLogRoutes = require("../../src/routes/adminAuditLogRoutes");
const adminAuthRoutes = require("../../src/routes/adminAuthRoutes");
const mainRoutes = require("../../src/routes/index");

// Muat app dalam mode production agar router dokumentasi tidak ter-mount.
// Dengan begitu daftar router di bawah benar-benar mencerminkan route bisnis
// yang tersedia di production, dan docs yang tidak sengaja ikut ter-mount akan
// terdeteksi sebagai router tak terdaftar.
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";

let app;

try {
  app = require("../../src/app");
} finally {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

const SPEC_PATH = path.join(__dirname, "../../docs/openapi.yaml");
const REQUIRED_OPERATIONS = [
  ["get", "/health"],
  ["get", "/200"],
  ["get", "/ready"],
  ["post", "/api/auth/register"],
  ["post", "/api/auth/login"],
  ["post", "/api/auth/refresh"],
  ["post", "/api/auth/logout"],
  ["put", "/api/auth/password"],
  ["get", "/api/auth/me"],
  ["post", "/api/admin/auth/login"],
  ["post", "/api/admin/auth/refresh"],
  ["post", "/api/admin/auth/logout"],
  ["put", "/api/admin/auth/password"],
  ["get", "/api/admin/auth/me"],
  ["get", "/api/products"],
  ["get", "/api/products/{id}"],
  ["get", "/api/categories"],
  ["get", "/api/categories/slug/{slug}"],
  ["get", "/api/categories/{id}"],
  ["get", "/api/cart"],
  ["post", "/api/cart"],
  ["put", "/api/cart/{id}"],
  ["delete", "/api/cart/{id}"],
  ["delete", "/api/cart"],
  ["post", "/api/orders/checkout"],
  ["get", "/api/orders"],
  ["get", "/api/orders/{id}"],
  ["post", "/api/orders/{orderId}/pay"],
  ["post", "/api/orders/webhook/payment"],
  ["get", "/api/admin/products"],
  ["get", "/api/admin/products/{id}"],
  ["post", "/api/admin/products"],
  ["put", "/api/admin/products/{id}"],
  ["delete", "/api/admin/products/{id}"],
  ["get", "/api/admin/categories"],
  ["get", "/api/admin/categories/{id}"],
  ["post", "/api/admin/categories"],
  ["put", "/api/admin/categories/{id}"],
  ["delete", "/api/admin/categories/{id}"],
  ["get", "/api/admin/orders/summary"],
  ["get", "/api/admin/orders"],
  ["get", "/api/admin/orders/{orderId}"],
  ["patch", "/api/admin/orders/{orderId}/status"],
  ["get", "/api/admin/audit-logs"],
];

const ROUTER_MOUNTS = [
  [authRoutes, "/api/auth"],
  [orderRoutes, "/api/orders"],
  [cartRoutes, "/api/cart"],
  [paymentRoutes, "/api"],
  [productRoutes, "/api/products"],
  [categoryRoutes, "/api/categories"],
  [adminProductRoutes, "/api/admin"],
  [adminCategoryRoutes, "/api/admin"],
  [adminAuditLogRoutes, "/api/admin"],
  [adminAuthRoutes, "/api/admin/auth"],
  [mainRoutes, "/api"],
];

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const toOpenApiPath = (prefix, routePath) => {
  const full = `${prefix}${routePath}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return full.length > 1 && full.endsWith("/") ? full.slice(0, -1) : full;
};

const getAppRouter = (targetApp = app) => targetApp.router || targetApp._router;

// Route yang dipasang langsung pada app (mis. health check) tetap harus masuk
// perbandingan exact-set.
const collectDirectAppOperations = (targetApp = app) => {
  const operations = new Set();

  for (const layer of getAppRouter(targetApp).stack) {
    if (!layer.route) continue;

    for (const method of Object.keys(layer.route.methods)) {
      operations.add(
        `${method.toUpperCase()} ${toOpenApiPath("", layer.route.path)}`,
      );
    }
  }

  return operations;
};

// Router apa pun yang ter-mount dari app, termasuk router bersarang, harus
// terdaftar di ROUTER_MOUNTS. Ini menutup celah router baru yang tidak masuk
// daftar hardcoded.
const collectMountedRouters = (
  targetApp = app,
  router = getAppRouter(targetApp),
  collected = new Set(),
) => {
  for (const layer of router.stack) {
    const child = layer.handle;

    if (layer.route || !child || !Array.isArray(child.stack)) continue;
    if (collected.has(child)) continue;

    collected.add(child);
    collectMountedRouters(targetApp, child, collected);
  }

  return collected;
};

const collectRouterOperations = () => {
  const operations = collectDirectAppOperations();

  for (const [router, prefix] of ROUTER_MOUNTS) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        operations.add(
          `${method.toUpperCase()} ${toOpenApiPath(prefix, layer.route.path)}`,
        );
      }
    }
  }

  return operations;
};

const collectSpecOperations = () => {
  const operations = new Set();

  for (const [routePath, pathItem] of Object.entries(api.paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        operations.add(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }

  return operations;
};

let api;

before(async () => {
  api = await SwaggerParser.validate(SPEC_PATH);
});

test("spec OpenAPI valid", () => {
  assert.equal(api.openapi, "3.0.3");
  assert.equal(typeof api.info.title, "string");
  assert.ok(api.servers.length > 0);
  assert.ok(api.components.securitySchemes.userBearer);
  assert.ok(api.components.securitySchemes.adminBearer);
  assert.ok(api.components.securitySchemes.userRefreshCookie);
  assert.ok(api.components.securitySchemes.adminRefreshCookie);
});

test("seluruh operasi terdokumentasi", () => {
  for (const [method, routePath] of REQUIRED_OPERATIONS) {
    assert.ok(api.paths[routePath]?.[method], `${method} ${routePath} hilang`);
  }
});

test("setiap operasi punya metadata dan response", () => {
  const operationIds = new Set();

  for (const [method, routePath] of REQUIRED_OPERATIONS) {
    const operation = api.paths[routePath][method];
    assert.ok(operation.summary, `${method} ${routePath} tanpa summary`);
    assert.ok(Array.isArray(operation.tags) && operation.tags.length > 0);
    assert.ok(operation.operationId);
    assert.equal(operationIds.has(operation.operationId), false);
    operationIds.add(operation.operationId);
    assert.ok(Object.keys(operation.responses).length > 0);
  }
});

test("operasi spec sama persis dengan route Express", () => {
  assert.deepEqual(
    [...collectSpecOperations()].sort(),
    [...collectRouterOperations()].sort(),
  );
});

test("spec memuat 44 operasi", () => {
  assert.equal(collectSpecOperations().size, 44);
});

test("guard mengenali route langsung pada app", () => {
  const express = require("express");
  const syntheticApp = express();
  syntheticApp.get("/direct", (req, res) => res.end());

  assert.deepEqual(
    [...collectDirectAppOperations(syntheticApp)],
    ["GET /direct"],
  );
});

test("guard mengenali router baru yang ter-mount", () => {
  const express = require("express");
  const syntheticApp = express();
  const parentRouter = express.Router();
  const childRouter = express.Router();
  childRouter.get("/drift", (req, res) => res.end());
  parentRouter.use("/child", childRouter);
  syntheticApp.use("/parent", parentRouter);

  const mountedRouters = collectMountedRouters(syntheticApp);

  assert.ok(mountedRouters.has(parentRouter));
  assert.ok(mountedRouters.has(childRouter));
});

test("setiap router aplikasi terdaftar di ROUTER_MOUNTS", () => {
  const mountedRouters = collectMountedRouters();
  const registeredRouters = new Set(ROUTER_MOUNTS.map(([router]) => router));

  for (const router of mountedRouters) {
    assert.ok(
      registeredRouters.has(router),
      "router ter-mount tidak terdaftar di ROUTER_MOUNTS",
    );
  }

  for (const router of registeredRouters) {
    assert.ok(
      mountedRouters.has(router),
      "router terdaftar di ROUTER_MOUNTS tidak ter-mount di app",
    );
  }
});

test("operasi ber-security mendokumentasikan 401 dan 403", () => {
  for (const [routePath, pathItem] of Object.entries(api.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const secured = Array.isArray(operation.security) &&
        operation.security.length > 0;

      if (!secured) continue;

      assert.ok(
        operation.responses["401"],
        `${method} ${routePath} tanpa response 401`,
      );
      assert.ok(
        operation.responses["403"],
        `${method} ${routePath} tanpa response 403`,
      );
    }
  }
});

test("operasi admin memakai adminBearer", () => {
  const refreshCookieRoutes = new Set([
    "/api/admin/auth/refresh",
    "/api/admin/auth/logout",
  ]);

  for (const [routePath, pathItem] of Object.entries(api.paths)) {
    if (!routePath.startsWith("/api/admin")) continue;
    if (routePath === "/api/admin/auth/login") continue;

    for (const method of HTTP_METHODS) {
      if (!pathItem[method]) continue;

      if (refreshCookieRoutes.has(routePath)) {
        assert.deepEqual(
          pathItem[method].security,
          [{ adminRefreshCookie: [] }],
          `${method} ${routePath} tidak memakai adminRefreshCookie`,
        );
        continue;
      }

      assert.deepEqual(
        pathItem[method].security,
        [{ adminBearer: [] }],
        `${method} ${routePath} tidak memakai adminBearer`,
      );
    }
  }

  assert.equal(api.paths["/api/admin/auth/login"].post.security, undefined);
});

test("operasi user memakai userBearer", () => {
  for (const [routePath, pathItem] of Object.entries(api.paths)) {
    const isUserOperation =
      routePath === "/api/auth/me" ||
      routePath === "/api/auth/password" ||
      routePath.startsWith("/api/cart") ||
      (routePath.startsWith("/api/orders") &&
        routePath !== "/api/orders/webhook/payment");

    if (!isUserOperation) continue;

    for (const method of HTTP_METHODS) {
      if (!pathItem[method]) continue;

      assert.deepEqual(
        pathItem[method].security,
        [{ userBearer: [] }],
        `${method} ${routePath} tidak memakai userBearer`,
      );
    }
  }

  assert.deepEqual(api.paths["/api/auth/refresh"].post.security, [
    { userRefreshCookie: [] },
  ]);
  assert.deepEqual(api.paths["/api/auth/logout"].post.security, [
    { userRefreshCookie: [] },
  ]);
});

test("operasi cookie mendokumentasikan Origin, 401, 403, dan Set-Cookie", () => {
  const cookieOperations = [
    ["post", "/api/auth/refresh"],
    ["post", "/api/auth/logout"],
    ["post", "/api/admin/auth/refresh"],
    ["post", "/api/admin/auth/logout"],
  ];

  for (const [method, routePath] of cookieOperations) {
    const operation = api.paths[routePath][method];

    assert.ok(operation.responses["401"], `${method} ${routePath} tanpa 401`);
    assert.ok(operation.responses["403"], `${method} ${routePath} tanpa 403`);
    assert.ok(operation.responses["429"], `${method} ${routePath} tanpa 429`);
    assert.ok(
      operation.responses["200"].headers?.["Set-Cookie"],
      `${method} ${routePath} tanpa header Set-Cookie`,
    );

    const origin = (operation.parameters || []).find(
      (parameter) =>
        parameter.in === "header" && parameter.name === "Origin",
    );
    assert.ok(origin, `${method} ${routePath} tanpa parameter Origin`);
    assert.equal(origin.required, true);
  }

  const setCookieOperations = [
    ["post", "/api/auth/login"],
    ["post", "/api/auth/refresh"],
    ["post", "/api/auth/logout"],
    ["put", "/api/auth/password"],
    ["post", "/api/admin/auth/login"],
    ["post", "/api/admin/auth/refresh"],
    ["post", "/api/admin/auth/logout"],
    ["put", "/api/admin/auth/password"],
  ];

  for (const [method, routePath] of setCookieOperations) {
    assert.ok(
      api.paths[routePath][method].responses["200"].headers?.["Set-Cookie"],
      `${method} ${routePath} tanpa header Set-Cookie`,
    );
  }
});

test("webhook tanpa security scheme dan mendokumentasikan 403", () => {
  const webhook = api.paths["/api/orders/webhook/payment"].post;

  assert.deepEqual(webhook.security, []);
  assert.ok(webhook.responses["403"]);
});

test("matriks auth dan error eksplisit", () => {
  assert.ok(api.paths["/api/auth/login"].post.responses["401"]);
  assert.ok(api.paths["/api/orders/{orderId}/pay"].post.responses["400"]);
  assert.ok(api.paths["/api/orders/webhook/payment"].post.responses["403"]);
});

test("spec tidak memuat contoh JWT atau service role", () => {
  const rawSpec = fs.readFileSync(SPEC_PATH, "utf8");

  assert.doesNotMatch(rawSpec, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(rawSpec, /service_role/);
});
