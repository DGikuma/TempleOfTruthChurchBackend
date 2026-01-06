// src/controllers/user.controller.ts
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import logger from '../utils/logger';
import { UploadService } from '../services/upload.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class UserController {
    static async getProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

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
                            phone: true,
                            role: true,
                            avatar: true,
                        },
                    },
                    groupMembers: {
                        include: {
                            group: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                    description: true,
                                },
                            },
                        },
                    },
                    servingRoles: {
                        include: {
                            ministry: {
                                select: {
                                    id: true,
                                    name: true,
                                    description: true,
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

    static async updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const updateData = req.body;

            // Remove fields that shouldn't be updated directly
            delete updateData.email;
            delete updateData.password;
            delete updateData.role;
            delete updateData.status;

            const user = await prisma.user.update({
                where: { id: userId },
                data: updateData,
                include: {
                    address: true,
                },
            });

            const { password: _, ...userWithoutPassword } = user;

            res.status(200).json({
                status: 'success',
                message: 'Profile updated successfully',
                data: {
                    user: userWithoutPassword,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateAddress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const addressData = req.body;

            // Check if address exists
            const existingAddress = await prisma.address.findUnique({
                where: { userId },
            });

            let address;
            if (existingAddress) {
                address = await prisma.address.update({
                    where: { userId },
                    data: addressData,
                });
            } else {
                address = await prisma.address.create({
                    data: {
                        ...addressData,
                        userId,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Address updated successfully',
                data: { address },
            });
        } catch (error) {
            next(error);
        }
    }

    static async uploadAvatar(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            if (!req.file) {
                res.status(400).json({
                    status: 'error',
                    message: 'No file uploaded',
                });
                return;
            }

            // Upload to S3
            const uploadResult = await UploadService.uploadFile(req.file, 'avatars', {
                userId,
                purpose: 'avatar',
            });

            // Update user with avatar URL
            await prisma.user.update({
                where: { id: userId },
                data: { avatar: uploadResult.url },
            });

            res.status(200).json({
                status: 'success',
                message: 'Avatar uploaded successfully',
                data: {
                    avatarUrl: uploadResult.url,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteAvatar(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { avatar: true },
            });

            if (user?.avatar) {
                // Extract key from URL and delete from S3
                const urlParts = user.avatar.split('/');
                const key = urlParts.slice(3).join('/'); // Remove bucket and domain parts

                await UploadService.deleteFile(key);
            }

            // Update user
            await prisma.user.update({
                where: { id: userId },
                data: { avatar: null },
            });

            res.status(200).json({
                status: 'success',
                message: 'Avatar deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getFamilyMembers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    familyMembers: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true,
                            role: true,
                            avatar: true,
                            birthDate: true,
                            gender: true,
                        },
                    },
                },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    familyMembers: user?.familyMembers || [],
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async addFamilyMember(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { email, relationship } = req.body;

            // Find user by email
            const familyMember = await prisma.user.findUnique({
                where: { email },
            });

            if (!familyMember) {
                res.status(404).json({
                    status: 'error',
                    message: 'User not found',
                });
                return;
            }

            // Update family head
            await prisma.user.update({
                where: { id: familyMember.id },
                data: {
                    familyHeadId: userId,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Family member added successfully',
                data: {
                    familyMember: {
                        id: familyMember.id,
                        firstName: familyMember.firstName,
                        lastName: familyMember.lastName,
                        email: familyMember.email,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async removeFamilyMember(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { memberId } = req.params;

            // Verify the user is the family head
            const member = await prisma.user.findUnique({
                where: { id: memberId },
            });

            if (!member || member.familyHeadId !== userId) {
                res.status(403).json({
                    status: 'error',
                    message: 'Not authorized to remove this family member',
                });
                return;
            }

            // Remove family relationship
            await prisma.user.update({
                where: { id: memberId },
                data: {
                    familyHeadId: null,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Family member removed successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserGroups(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            const groupMemberships = await prisma.groupMember.findMany({
                where: { userId },
                include: {
                    group: {
                        include: {
                            leader: {
                                select: {
                                    id: true,
                                    firstName: true,
                                    lastName: true,
                                    email: true,
                                },
                            },
                        },
                    },
                },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    groups: groupMemberships.map(membership => ({
                        ...membership.group,
                        role: membership.role,
                        joinedAt: membership.joinedAt,
                    })),
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getServingRoles(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            const servingRoles = await prisma.servingRole.findMany({
                where: { userId },
                include: {
                    ministry: true,
                },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    servingRoles,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async getAllUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                search,
                role,
                status,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {};

            if (search) {
                filter.OR = [
                    { firstName: { contains: search as string, mode: 'insensitive' } },
                    { lastName: { contains: search as string, mode: 'insensitive' } },
                    { email: { contains: search as string, mode: 'insensitive' } },
                ];
            }

            if (role) filter.role = role;
            if (status) filter.status = status;

            // Get total count
            const total = await prisma.user.count({ where: filter });

            // Get users
            const users = await prisma.user.findMany({
                where: filter,
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    role: true,
                    status: true,
                    emailVerified: true,
                    membershipDate: true,
                    lastLogin: true,
                    createdAt: true,
                    address: true,
                },
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    users,
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total,
                        pages: Math.ceil(total / Number(limit)),
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    address: true,
                    familyMembers: true,
                    groupMembers: {
                        include: {
                            group: true,
                        },
                    },
                    servingRoles: {
                        include: {
                            ministry: true,
                        },
                    },
                    donations: {
                        take: 10,
                        orderBy: { createdAt: 'desc' },
                    },
                    eventRegistrations: {
                        take: 10,
                        include: {
                            event: true,
                        },
                        orderBy: { createdAt: 'desc' },
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

    static async updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;
            const updateData = req.body;

            // Prevent updating certain fields
            delete updateData.email;
            delete updateData.password;

            const user = await prisma.user.update({
                where: { id: userId },
                data: updateData,
                include: {
                    address: true,
                },
            });

            const { password: _, ...userWithoutPassword } = user;

            res.status(200).json({
                status: 'success',
                message: 'User updated successfully',
                data: {
                    user: userWithoutPassword,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateUserRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;
            const { role, status } = req.body;

            const user = await prisma.user.update({
                where: { id: userId },
                data: {
                    role,
                    ...(status && { status }),
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'User role updated successfully',
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        role: user.role,
                        status: user.status,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;

            // Don't allow deleting yourself
            if (userId === req.user.id) {
                res.status(400).json({
                    status: 'error',
                    message: 'Cannot delete your own account',
                });
                return;
            }

            await prisma.user.delete({
                where: { id: userId },
            });

            res.status(200).json({
                status: 'success',
                message: 'User deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserActivity(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;

            const activities = await prisma.activityLog.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 50,
            });

            res.status(200).json({
                status: 'success',
                data: {
                    activities,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const [
                totalUsers,
                activeUsers,
                newUsersThisMonth,
                usersByRole,
                usersByStatus,
            ] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({
                    where: {
                        status: 'ACTIVE',
                        lastLogin: {
                            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                        },
                    },
                }),
                prisma.user.count({
                    where: {
                        createdAt: {
                            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                        },
                    },
                }),
                prisma.user.groupBy({
                    by: ['role'],
                    _count: true,
                }),
                prisma.user.groupBy({
                    by: ['status'],
                    _count: true,
                }),
            ]);

            res.status(200).json({
                status: 'success',
                data: {
                    totalUsers,
                    activeUsers,
                    newUsersThisMonth,
                    usersByRole: usersByRole.reduce((acc, item) => {
                        acc[item.role] = item._count;
                        return acc;
                    }, {} as Record<string, number>),
                    usersByStatus: usersByStatus.reduce((acc, item) => {
                        acc[item.status] = item._count;
                        return acc;
                    }, {} as Record<string, number>),
                },
            });
        } catch (error) {
            next(error);
        }
    }
}