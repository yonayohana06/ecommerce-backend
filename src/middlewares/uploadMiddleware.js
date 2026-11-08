const multer = require("multer");
const { HttpError } = require("../utils/httpError");

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new HttpError(400, "Hanya file gambar yang diperbolehkan!"), false);
    }
  },
});

module.exports = upload;
