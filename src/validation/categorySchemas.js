const { z, requiredString, positiveId } = require("./common");

const categoryFields = {
  name: requiredString("Nama kategori wajib diisi")
    .trim()
    .min(1, "Nama kategori wajib diisi")
    .max(100, "Nama kategori maksimal 100 karakter."),
  slug: z
    .string({ error: "Slug kategori harus berupa teks" })
    .max(100, "Slug kategori maksimal 100 karakter.")
    .optional(),
  icon_url: z
    .string({ error: "URL ikon harus berupa teks" })
    .max(2048, "URL ikon maksimal 2048 karakter.")
    .nullable()
    .optional(),
};

const listQuery = z.object({
  search: z
    .string({ error: "search harus berupa teks" })
    .max(100, "search maksimal 100 karakter.")
    .optional(),
});

const idParams = z.object({
  id: positiveId("ID kategori tidak valid"),
});

const slugParams = z.object({
  slug: requiredString("Slug kategori wajib disertakan")
    .min(1, "Slug kategori wajib disertakan")
    .max(100, "Slug kategori maksimal 100 karakter."),
});

const createBody = z.object(categoryFields);

const updateBody = z.object(categoryFields).partial();

module.exports = {
  listQuery,
  idParams,
  slugParams,
  createBody,
  updateBody,
};
