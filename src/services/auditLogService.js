const { pool } = require("../config/db");
const { logger } = require("../utils/logger");
const { parsePagination, buildPagination } = require("../utils/pagination");

const toJsonParam = (value) =>
  value === undefined || value === null ? null : JSON.stringify(value);

const createAuditLog = async ({
  actor,
  action,
  entityType,
  entityId,
  before,
  after,
  ipAddress,
}) => {
  const result = await pool.query(
    `INSERT INTO audit_logs
       (actor_id, actor_email, action, entity_type, entity_id,
        before_data, after_data, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     RETURNING *`,
    [
      actor && actor.userId !== undefined ? actor.userId : null,
      actor && actor.email ? actor.email : null,
      action,
      entityType,
      String(entityId),
      toJsonParam(before),
      toJsonParam(after),
      ipAddress || null,
    ],
  );

  return result.rows[0];
};

// Pencatatan audit bersifat best-effort: kegagalan menulis audit tidak boleh
// membatalkan aksi utama yang sudah berhasil (mis. order sudah berubah status).
// Kegagalan tetap dicatat ke log server agar bisa ditindaklanjuti.
const recordAuditLog = async (params) => {
  try {
    return await createAuditLog(params);
  } catch (error) {
    logger.error({
      msg: "audit_log_failed",
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
    return null;
  }
};

const listAuditLogs = async ({
  page = 1,
  limit = 10,
  entityType,
  action,
  actorId,
} = {}) => {
  const {
    page: pageNum,
    limit: limitNum,
    offset,
  } = parsePagination({ page, limit });

  const whereClauses = [];
  const queryValues = [];

  if (entityType) {
    whereClauses.push(`entity_type = $${queryValues.length + 1}`);
    queryValues.push(entityType);
  }

  if (action) {
    whereClauses.push(`action = $${queryValues.length + 1}`);
    queryValues.push(action);
  }

  if (actorId) {
    whereClauses.push(`actor_id = $${queryValues.length + 1}`);
    queryValues.push(actorId);
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const logsQuery = `
    SELECT id, actor_id, actor_email, action, entity_type, entity_id,
           before_data, after_data, ip_address, created_at
    FROM audit_logs
    ${whereString}
    ORDER BY created_at DESC, id DESC
    LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM audit_logs
    ${whereString}
  `;

  const [logsResult, countResult] = await Promise.all([
    pool.query(logsQuery, [...queryValues, limitNum, offset]),
    pool.query(countQuery, queryValues),
  ]);

  const totalItems = parseInt(countResult.rows[0].total, 10);

  return {
    logs: logsResult.rows,
    pagination: buildPagination({
      page: pageNum,
      limit: limitNum,
      totalItems,
    }),
  };
};

module.exports = {
  createAuditLog,
  recordAuditLog,
  listAuditLogs,
};
