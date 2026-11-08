const {
  z,
  requiredString,
  positiveId,
  nonNegativeInt,
  nonNegativeNumber,
  optionalCategoryId,
  paginationFields,
} = require("./common");

const productFields = {
  name: requiredString("Nama produk wajib diisi")
    .trim()
    .min(1, "Nama produk wajib diisi")
    .max(100, "Nama produk maksimal 100 karakter."),
  description: z
    .string({ error: "Deskripsi harus berupa teks" })
    .max(5000, "Deskripsi maksimal 5000 karakter.")
    .nullable()
    .optional(),
  price: nonNegativeNumber(
    "Harga wajib diisi dan harus berupa angka yang valid",
  ).refine((value) => value <= 999999999999, "Harga terlalu besar"),
  stock: nonNegativeInt(
    "Stok wajib diisi dan harus berupa bilangan bulat positif atau nol",
  ).refine((value) => value <= 2147483647, "Stok terlalu besar"),
  category_id: optionalCategoryId.optional(),
  image_url: z
    .string({ error: "URL gambar harus berupa teks" })
    .max(2048, "URL gambar maksimal 2048 karakter.")
    .nullable()
    .optional(),
  is_active: z
    .boolean({ error: "is_active harus berupa boolean" })
    .optional(),
};

const listQuery = z.object({
  category_id: optionalCategoryId.optional(),
  search: z
    .string({ error: "search harus berupa teks" })
    .max(100, "search maksimal 100 karakter.")
    .optional(),
  ...paginationFields,
});

const idParams = z.object({
  id: positiveId("ID produk tidak valid"),
});

const createBody = z.object(productFields);

const updateBody = z.object(productFields).partial();

module.exports = {
  listQuery,
  idParams,
  createBody,
  updateBody,
};
