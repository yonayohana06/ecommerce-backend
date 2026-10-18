const adminAuthService = require("../services/adminAuthService");

const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Email dan password wajib diisi.",
      });
    }

    const loginData = await adminAuthService.loginAdmin({ email, password });

    return res.status(200).json({
      code: 200,
      message: "Login admin berhasil",
      data: loginData,
    });
  } catch (error) {
    const statusCode = error.statusCode || 401;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message,
    });
  }
};

const handleGetProfile = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const profile = await adminAuthService.getAdminProfile(adminId);

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil profil administrator",
      data: profile,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message,
    });
  }
};

module.exports = {
  handleLogin,
  handleGetProfile,
};
