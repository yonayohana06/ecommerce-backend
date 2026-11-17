const adminAuthService = require("../services/adminAuthService");
const passwordService = require("../services/passwordService");
const {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} = require("../utils/refreshCookie");

const handleLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Email dan password wajib diisi.",
      });
    }

    const loginData = await adminAuthService.loginAdmin({ email, password });

    setRefreshCookie(res, {
      portal: "admin",
      token: loginData.refreshToken,
      expiresAt: loginData.refreshExpiresAt,
    });

    return res.status(200).json({
      code: 200,
      message: "Login admin berhasil",
      data: {
        admin: loginData.admin,
        token: loginData.token,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const handleRefresh = async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req, { portal: "admin" });

    if (!refreshToken) {
      return res.status(401).json({
        code: 401,
        message: "Refresh token tidak valid atau sudah kedaluwarsa.",
      });
    }

    const refreshed = await adminAuthService.refreshAdminSession(refreshToken);

    setRefreshCookie(res, {
      portal: "admin",
      token: refreshed.refreshToken,
      expiresAt: refreshed.refreshExpiresAt,
    });

    return res.status(200).json({
      code: 200,
      message: "Token berhasil diperbarui",
      data: { token: refreshed.accessToken },
    });
  } catch (error) {
    clearRefreshCookie(res, { portal: "admin" });
    return next(error);
  }
};

const handleLogout = async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req, { portal: "admin" });

    if (refreshToken) {
      await adminAuthService.logoutAdmin(refreshToken);
    }

    clearRefreshCookie(res, { portal: "admin" });

    return res.status(200).json({
      code: 200,
      message: "Logout berhasil",
    });
  } catch (error) {
    clearRefreshCookie(res, { portal: "admin" });
    return next(error);
  }
};

const handleChangePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    await passwordService.changePassword({
      userId: req.user.userId,
      expectedRole: "admin",
      currentPassword: current_password,
      newPassword: new_password,
    });

    clearRefreshCookie(res, { portal: "admin" });

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
    const adminId = req.user.userId;
    const profile = await adminAuthService.getAdminProfile(adminId);

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil profil administrator",
      data: profile,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleLogin,
  handleRefresh,
  handleLogout,
  handleChangePassword,
  handleGetProfile,
};
