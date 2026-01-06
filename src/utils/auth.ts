// src/utils/auth.ts
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import config from '../config';

interface TokenPayload {
    userId: string;
    email: string;
    role: string;
}

export const generateTokens = (user: any): { accessToken: string; refreshToken: string } => {
    const payload: TokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
    };

    const accessToken = jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpire,
    });

    const refreshToken = jwt.sign(
        { userId: user.id },
        config.refreshTokenSecret,
        { expiresIn: config.refreshTokenExpire }
    );

    return { accessToken, refreshToken };
};

export const verifyToken = (token: string, secret: string): TokenPayload | null => {
    try {
        return jwt.verify(token, secret) as TokenPayload;
    } catch (error) {
        return null;
    }
};

export const decodeToken = (token: string): TokenPayload | null => {
    try {
        return jwt.decode(token) as TokenPayload;
    } catch (error) {
        return null;
    }
};

export const clearCookies = (res: Response): void => {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
};

export const setAuthCookies = (res: Response, accessToken: string, refreshToken: string): void => {
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
};

export const generatePasswordResetToken = (): string => {
    return require('crypto').randomBytes(32).toString('hex');
};

export const generateEmailVerificationToken = (): string => {
    return require('crypto').randomBytes(32).toString('hex');
};

export const hashPassword = async (password: string): Promise<string> => {
    const bcrypt = require('bcryptjs');
    return bcrypt.hash(password, 12);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
    const bcrypt = require('bcryptjs');
    return bcrypt.compare(password, hash);
};

export const validatePasswordStrength = (password: string): { valid: boolean; message?: string } => {
    if (password.length < 8) {
        return { valid: false, message: 'Password must be at least 8 characters long' };
    }

    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one uppercase letter' };
    }

    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one lowercase letter' };
    }

    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one number' };
    }

    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one special character' };
    }

    return { valid: true };
};