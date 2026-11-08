const { HttpError } = require("../utils/httpError");

const replaceObjectValues = (target, source) => {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, source);
};

const validate = (schemas) => {
  return (req, res, next) => {
    for (const source of ["params", "query", "body"]) {
      const schema = schemas[source];

      if (!schema) {
        continue;
      }

      const result = schema.safeParse(req[source]);

      if (!result.success) {
        const issue = result.error.issues[0];
        const field = issue.path.join(".");
        const message = field
          ? `${field}: ${issue.message}`
          : issue.message;

        return next(new HttpError(400, message));
      }

      if (source === "body") {
        req.body = result.data;
      } else {
        replaceObjectValues(req[source], result.data);
      }
    }

    return next();
  };
};

module.exports = validate;
