const { z, positiveId, paginationFields } = require("./common");

const optionalQueryString = (label, max) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string({ error: `${label} harus berupa teks` })
      .max(max, `${label} maksimal ${max} karakter.`)
      .optional(),
  );

const listQuery = z.object({
  entity_type: optionalQueryString("entity_type", 50),
  action: optionalQueryString("action", 100),
  actor_id: z.preprocess(
    (value) => (value === "" ? undefined : value),
    positiveId("ID aktor tidak valid").optional(),
  ),
  ...paginationFields,
});

module.exports = {
  listQuery,
};
