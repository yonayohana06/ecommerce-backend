const auditLogService = require("../services/auditLogService");

const getAuditLogs = async (req, res, next) => {
  try {
    const { entity_type, action, actor_id, page, limit } = req.query;

    const result = await auditLogService.listAuditLogs({
      entityType: entity_type,
      action,
      actorId: actor_id,
      page,
      limit,
    });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil audit log",
      data: result.logs,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAuditLogs,
};
