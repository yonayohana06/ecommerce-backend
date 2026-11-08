const multer = require("multer");
const { HttpError } = require("../utils/httpError");

const ALLOWED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

const startsWith = (buffer, signature) =>
  buffer.length >= signature.length &&
  buffer.subarray(0, signature.length).equals(signature);

// Deteksi tipe gambar dari magic bytes, bukan dari header Content-Type client.
const detectImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;

  if (startsWith(buffer, PNG_SIGNATURE)) return "image/png";
  if (startsWith(buffer, JPEG_SIGNATURE)) return "image/jpeg";

  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  if (isWebp) return "image/webp";

  return null;
};

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(
        new HttpError(
          400,
          "Hanya file gambar JPEG, PNG, atau WebP yang diperbolehkan!",
        ),
        false,
      );
    }
  },
});

// Jalankan setelah multer: pastikan isi file benar-benar gambar yang diizinkan.
const validateImageSignature = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const detectedMime = detectImageType(req.file.buffer);

  if (!detectedMime) {
    return next(
      new HttpError(
        400,
        "File gambar tidak valid: isi file bukan JPEG, PNG, atau WebP.",
      ),
    );
  }

  if (detectedMime !== req.file.mimetype) {
    return next(
      new HttpError(400, "Tipe file tidak sesuai dengan isi file."),
    );
  }

  req.file.detectedMime = detectedMime;
  req.file.extension = ALLOWED_IMAGE_TYPES[detectedMime];

  return next();
};

module.exports = {
  ALLOWED_IMAGE_TYPES,
  detectImageType,
  upload,
  validateImageSignature,
};
