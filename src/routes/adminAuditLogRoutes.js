const express = require("express");
const router = express.Router();
const adminAuditLogController = require("../controllers/adminAuditLogController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { listQuery } = require("../validation/auditLogSchemas");

router.get(
  "/audit-logs",
  verifyAdminToken,
  validate({ query: listQuery }),
  adminAuditLogController.getAuditLogs,
);

module.exports = router;
