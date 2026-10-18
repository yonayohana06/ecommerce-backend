const authService = require("../services/authService");

const handleRegister = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Nama, email, dan password wajib diisi.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        code: 400,
        message: "Password minimal 6 karakter.",
      });
    }

    const newUser = await authService.registerUser({ name, email, password });

    return res.status(201).json({
      code: 201,
      message: "Registrasi akun berhasil",
      data: newUser,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message,
    });
  }
};

const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Email dan password wajib diisi.",
      });
    }

    const loginData = await authService.loginUser({ email, password });

    return res.status(200).json({
      code: 200,
      message: "Login berhasil",
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
    const userId = req.user.userId;
    const profile = await authService.getUserProfile(userId);

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil profil pengguna",
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
  handleRegister,
  handleLogin,
  handleGetProfile,
};