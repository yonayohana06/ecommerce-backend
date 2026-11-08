const { z } = require("zod");
const ORDER_STATUS = require("../constants/orderStatus");

const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;
const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);
const ORDER_STATUS_MESSAGE = `Status tidak valid. Pilihan: ${ORDER_STATUS_VALUES.join(", ")}`;
const ORDER_FILTER_MESSAGE = `Filter status tidak valid. Pilihan: ${ORDER_STATUS_VALUES.join(", ")}`;

const requiredString = (message) =>
  z.string({
    error: message,
  });

const positiveId = (label) =>
  requiredString(`${label} tidak valid`).regex(
    POSITIVE_INT_PATTERN,
    `${label} tidak valid`,
  );

const numericInput = (schema) =>
  z.preprocess((value) => {
    if (typeof value === "string" && value.trim() !== "") {
      return Number(value);
    }

    return value;
  }, schema);

const positiveInt = (message) =>
  numericInput(
    z
      .number({
        error: message,
      })
      .int(message)
      .positive(message),
  );

const nonNegativeInt = (message) =>
  numericInput(
    z
      .number({
        error: message,
      })
      .int(message)
      .nonnegative(message),
  );

const nonNegativeNumber = (message) =>
  numericInput(
    z
      .number({
        error: message,
      })
      .nonnegative(message),
  );

const optionalCategoryId = z.preprocess(
  (value) => (value === "" ? null : value),
  numericInput(
    z
      .number({
        error: "harus berupa bilangan bulat positif",
      })
      .int("harus berupa bilangan bulat positif")
      .positive("harus berupa bilangan bulat positif")
      .nullable(),
  ),
);

const page = requiredString("harus berupa bilangan bulat positif")
  .regex(POSITIVE_INT_PATTERN, "harus berupa bilangan bulat positif")
  .default("1")
  .transform(Number);

const limit = requiredString("harus berupa bilangan bulat antara 1 dan 100")
  .regex(POSITIVE_INT_PATTERN, "harus berupa bilangan bulat antara 1 dan 100")
  .default("10")
  .transform(Number)
  .refine(
    (value) => value <= 100,
    "harus berupa bilangan bulat antara 1 dan 100",
  );

const paginationFields = {
  page,
  limit,
};

const orderStatus = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .enum(ORDER_STATUS_VALUES, {
      error: ORDER_STATUS_MESSAGE,
    })
    .optional(),
);

const orderStatusFilter = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .enum(ORDER_STATUS_VALUES, {
      error: ORDER_FILTER_MESSAGE,
    })
    .optional(),
);

module.exports = {
  z,
  ORDER_STATUS_VALUES,
  ORDER_STATUS_MESSAGE,
  ORDER_FILTER_MESSAGE,
  requiredString,
  positiveId,
  numericInput,
  positiveInt,
  nonNegativeInt,
  nonNegativeNumber,
  optionalCategoryId,
  paginationFields,
  orderStatus,
  orderStatusFilter,
};
