const notFound = (req, res) => {
  return res.status(404).json({
    code: 404,
    message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
};

module.exports = notFound;
