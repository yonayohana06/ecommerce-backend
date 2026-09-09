const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const registerUser = async ({ name, email, password }) => {
    // 1. Cek apakah email sudah terdaftar
    const existingUser = await db.query(
        'SELECT id FROM users WHERE email = $1;',
        [email]
    );
    if (existingUser.rows.length > 0) {
        throw new Error('Email sudah terdaftar. Silakan gunakan email lain.');
    }

    // 2. Hash password menggunakan bcrypt (salt round = 10)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Simpan ke database
    const insertQuery = `
    INSERT INTO users (name, email, password_hash)
    VALUES ($1, $2, $3)
    RETURNING id, name, email, created_at;
  `;
    const result = await db.query(insertQuery, [name, email, hashedPassword]);
    return result.rows[0];
};

const loginUser = async ({ email, password }) => {
    // 1. Cari user berdasarkan email
    const userResult = await db.query(
        'SELECT id, name, email, password_hash FROM users WHERE email = $1;',
        [email]
    );

    if (userResult.rows.length === 0) {
        throw new Error('Kredensial tidak valid (Email atau Password salah).');
    }

    const user = userResult.rows[0];

    // 2. Cocokkan raw password dengan hashed password di DB
    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
        throw new Error('Kredensial tidak valid (Email atau Password salah).');
    }

    // 3. Buat JWT Token
    const tokenPayload = {
        userId: user.id,
        email: user.email,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
        },
        token,
    };
};

module.exports = {
    registerUser,
    loginUser,
};