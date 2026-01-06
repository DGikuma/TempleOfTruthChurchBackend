import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config';
import prisma from '../config/database';
import logger from '../utils/logger';
import { sendEmail } from '../services/email.service';
import { generateTokens, verifyToken, clearCookies } from '../utils/auth';
import { AuthRequest } from '../middleware/auth.middleware';

interface RegisterInput {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    birthDate?: string;
    gender?: string;
    maritalStatus?: string;
}

interface LoginInput {
    email: string;
    password: string;
}

export class AuthController {
    static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password, firstName, lastName, ...otherData }: RegisterInput = req.body;

            // Check if user exists
            const existingUser = await prisma.user.findUnique({
                where: { email },
            });

            if (existingUser) {
                res.status(400).json({
                    status: 'error',
                    message: 'User with this email already exists',
                });
                return;
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 12);

            // Create user
            const user = await prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    firstName,
                    lastName,
                    ...otherData,
                    status: 'PENDING',
                },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    status: true,
                    createdAt: true,
                },
            });

            // Generate verification token
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await prisma.verificationToken.create({
                data: {
                    token: verificationToken,
                    userId: user.id,
                    expires: verificationExpires,
                    type: 'EMAIL_VERIFICATION',
                },
            });

            // Send welcome email
            const verificationUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;

            await sendEmail({
                to: email,
                subject: 'Welcome to GracePoint Church!',
                template: 'welcome',
                data: {
                    name: `${firstName} ${lastName}`,
                    verificationUrl,
                    currentYear: new Date().getFullYear(),
                },
            });

            // Generate tokens
            const { accessToken, refreshToken } = generateTokens(user);

            // Set cookies
            res.cookie('access_token', accessToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.cookie('refresh_token', refreshToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000,
            });

            res.status(201).json({
                status: 'success',
                message: 'Registration successful. Please verify your email.',
                data: {
                    user,
                    accessToken,
                },
            });
        } catch (error) {
            logger.error('Registration error:', error);
            next(error);
        }
    }

    static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password }: LoginInput = req.body;

            // Find user
            const user = await prisma.user.findUnique({
                where: { email },
                include: {
                    address: true,
                },
            });

            if (!user || !user.password) {
                res.status(401).json({
                    status: 'error',
                    message: 'Invalid email or password',
                });
                return;
            }

            // Check password
            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (!isPasswordValid) {
                res.status(401).json({
                    status: 'error',
                    message: 'Invalid email or password',
                });
                return;
            }

            // Check if user is active
            if (user.status !== 'ACTIVE') {
                res.status(403).json({
                    status: 'error',
                    message: 'Account is not active. Please contact administrator.',
                });
                return;
            }

            // Update last login
            await prisma.user.update({
                where: { id: user.id },
                data: { lastLogin: new Date() },
            });

            // Generate tokens
            const { accessToken, refreshToken } = generateTokens(user);

            // Set cookies
            res.cookie('access_token', accessToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.cookie('refresh_token', refreshToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000,
            });

            // Remove password from response
            const { password: _, ...userWithoutPassword } = user;

            res.status(200).json({
                status: 'success',
                message: 'Login successful',
                data: {
                    user: userWithoutPassword,
                    accessToken,
                },
            });
        } catch (error) {
            logger.error('Login error:', error);
            next(error);
        }
    }

    static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            clearCookies(res);

            res.status(200).json({
                status: 'success',
                message: 'Logged out successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const refreshToken = req.cookies.refresh_token;

            if (!refreshToken) {
                res.status(401).json({
                    status: 'error',
                    message: 'Refresh token not found',
                });
                return;
            }

            const decoded = verifyToken(refreshToken, config.refreshTokenSecret) as any;

            if (!decoded) {
                res.status(401).json({
                    status: 'error',
                    message: 'Invalid refresh token',
                });
                return;
            }

            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
            });

            if (!user) {
                res.status(404).json({
                    status: 'error',
                    message: 'User not found',
                });
                return;
            }

            // Generate new tokens
            const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user);

            // Update cookies
            res.cookie('access_token', newAccessToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.cookie('refresh_token', newRefreshToken, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000,
            });

            res.status(200).json({
                status: 'success',
                data: {
                    accessToken: newAccessToken,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body;

            const user = await prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                // Don't reveal that user doesn't exist
                res.status(200).json({
                    status: 'success',
                    message: 'If an account exists with this email, you will receive a password reset link',
                });
                return;
            }

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetExpires = new Date(Date.now() + 1 * 60 * 60 * 1000);

            // Delete any existing reset tokens
            await prisma.verificationToken.deleteMany({
                where: {
                    userId: user.id,
                    type: 'PASSWORD_RESET',
                },
            });

            // Create new reset token
            await prisma.verificationToken.create({
                data: {
                    token: resetToken,
                    userId: user.id,
                    expires: resetExpires,
                    type: 'PASSWORD_RESET',
                },
            });

            // Send reset email
            const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

            await sendEmail({
                to: email,
                subject: 'Password Reset Request - GracePoint Church',
                template: 'password-reset',
                data: {
                    name: `${user.firstName} ${user.lastName}`,
                    resetUrl,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Password reset link sent to your email',
            });
        } catch (error) {
            logger.error('Forgot password error:', error);
            next(error);
        }
    }

    static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token, password } = req.body;

            // Find reset token
            const resetToken = await prisma.verificationToken.findFirst({
                where: {
                    token,
                    type: 'PASSWORD_RESET',
                    expires: { gt: new Date() },
                },
            });

            if (!resetToken) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid or expired reset token',
                });
                return;
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(password, 12);

            // Update user password
            await prisma.user.update({
                where: { id: resetToken.userId },
                data: {
                    password: hashedPassword,
                },
            });

            // Delete used reset token
            await prisma.verificationToken.delete({
                where: { id: resetToken.id },
            });

            // Send confirmation email
            const user = await prisma.user.findUnique({
                where: { id: resetToken.userId },
            });

            if (user) {
                await sendEmail({
                    to: user.email,
                    subject: 'Password Reset Successful - GracePoint Church',
                    template: 'password-reset-confirmation',
                    data: {
                        name: `${user.firstName} ${user.lastName}`,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Password reset successful',
            });
        } catch (error) {
            logger.error('Reset password error:', error);
            next(error);
        }
    }

    static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token } = req.body;

            const verificationToken = await prisma.verificationToken.findFirst({
                where: {
                    token,
                    type: 'EMAIL_VERIFICATION',
                    expires: { gt: new Date() },
                },
            });

            if (!verificationToken) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid or expired verification token',
                });
                return;
            }

            // Update user
            await prisma.user.update({
                where: { id: verificationToken.userId },
                data: {
                    emailVerified: true,
                    status: 'ACTIVE',
                },
            });

            // Delete verification token
            await prisma.verificationToken.delete({
                where: { id: verificationToken.id },
            });

            res.status(200).json({
                status: 'success',
                message: 'Email verified successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    address: true,
                    familyMembers: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true,
                        },
                    },
                    groupMembers: {
                        include: {
                            group: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!user) {
                res.status(404).json({
                    status: 'error',
                    message: 'User not found',
                });
                return;
            }

            const { password: _, ...userWithoutPassword } = user;

            res.status(200).json({
                status: 'success',
                data: {
                    user: userWithoutPassword,
                },
            });
        } catch (error) {
            next(error);
        }
    }
}