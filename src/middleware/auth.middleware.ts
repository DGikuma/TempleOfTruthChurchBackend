import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from '../config/database';
import logger from '../utils/logger';

export interface AuthRequest extends Request {
    user?: any;
}

export const authMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Get token from header or cookie
        let token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token && req.cookies.access_token) {
            token = req.cookies.access_token;
        }

        if (!token) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }

        // Verify token
        const decoded = jwt.verify(token, config.jwtSecret) as any;

        if (!decoded) {
            res.status(401).json({
                status: 'error',
                message: 'Invalid token',
            });
            return;
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                status: true,
                emailVerified: true,
                avatar: true,
            },
        });

        if (!user) {
            res.status(401).json({
                status: 'error',
                message: 'User not found',
            });
            return;
        }

        if (user.status !== 'ACTIVE') {
            res.status(403).json({
                status: 'error',
                message: 'Account is not active',
            });
            return;
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error: any) {
        if (error.name === 'TokenExpiredError') {
            res.status(401).json({
                status: 'error',
                message: 'Token expired',
                code: 'TOKEN_EXPIRED',
            });
            return;
        }

        if (error.name === 'JsonWebTokenError') {
            res.status(401).json({
                status: 'error',
                message: 'Invalid token',
                code: 'INVALID_TOKEN',
            });
            return;
        }

        logger.error('Auth middleware error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error',
        });
    }
};