const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const specPath = path.join(__dirname, "../docs/openapi.yaml");

SwaggerParser.validate(specPath)
  .then(() => {
    console.log(`OpenAPI valid: ${specPath}`);
  })
  .catch((error) => {
    console.error(`OpenAPI tidak valid: ${error.message}`);
    process.exitCode = 1;
  });
