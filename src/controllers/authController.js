const authService = require("../services/authService");
const passwordService = require("../services/passwordService");
const {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} = require("../utils/refreshCookie");

const handleRegister = async (req, res, next) => {
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
    return next(error);
  }
};

const handleLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Email dan password wajib diisi.",
      });
    }

    const loginData = await authService.loginUser({ email, password });

    setRefreshCookie(res, {
      portal: "user",
      token: loginData.refreshToken,
      expiresAt: loginData.refreshExpiresAt,
    });

    return res.status(200).json({
      code: 200,
      message: "Login berhasil",
      data: {
        user: loginData.user,
        token: loginData.token,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const handleRefresh = async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req, { portal: "user" });

    if (!refreshToken) {
      return res.status(401).json({
        code: 401,
        message: "Refresh token tidak valid atau sudah kedaluwarsa.",
      });
    }

    const refreshed = await authService.refreshUserSession(refreshToken);

    setRefreshCookie(res, {
      portal: "user",
      token: refreshed.refreshToken,
      expiresAt: refreshed.refreshExpiresAt,
    });

    return res.status(200).json({
      code: 200,
      message: "Token berhasil diperbarui",
      data: { token: refreshed.accessToken },
    });
  } catch (error) {
    clearRefreshCookie(res, { portal: "user" });
    return next(error);
  }
};

const handleLogout = async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req, { portal: "user" });

    if (refreshToken) {
      await authService.logoutUser(refreshToken);
    }

    clearRefreshCookie(res, { portal: "user" });

    return res.status(200).json({
      code: 200,
      message: "Logout berhasil",
    });
  } catch (error) {
    clearRefreshCookie(res, { portal: "user" });
    return next(error);
  }
};

const handleChangePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    await passwordService.changePassword({
      userId: req.user.userId,
      expectedRole: "user",
      currentPassword: current_password,
      newPassword: new_password,
    });

    clearRefreshCookie(res, { portal: "user" });

    return res.status(200).json({
      code: 200,
      message: "Password berhasil diubah. Silakan login ulang.",
    });
  } catch (error) {
    return next(error);
  }
};

const handleGetProfile = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const profile = await authService.getUserProfile(userId);

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil profil pengguna",
      data: profile,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleChangePassword,
  handleGetProfile,
};