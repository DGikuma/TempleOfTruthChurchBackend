import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { sendEmail } from '../services/email.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class PrayerController {
    // Public methods
    static async getPublicPrayers(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                category,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter - only show public, non-anonymous prayers
            const filter: any = {
                isPublic: true,
                isAnonymous: false,
                status: { in: ['PENDING', 'PRAYED'] },
            };

            if (category) filter.category = category;

            // Get total count
            const total = await prisma.prayerRequest.count({ where: filter });

            // Get prayers
            const prayers = await prisma.prayerRequest.findMany({
                where: filter,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    status: true,
                    createdAt: true,
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                        },
                    },
                    _count: {
                        select: {
                            prayedBy: true,
                        },
                    },
                },
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            // Format response
            const formattedPrayers = prayers.map(prayer => ({
                id: prayer.id,
                title: prayer.title,
                description: prayer.description,
                category: prayer.category,
                status: prayer.status,
                createdAt: prayer.createdAt,
                requesterName: prayer.user ? `${prayer.user.firstName} ${prayer.user.lastName}` : 'Anonymous',
                prayerCount: prayer._count.prayedBy,
            }));

            res.status(200).json({
                status: 'success',
                data: {
                    prayers: formattedPrayers,
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

    static async submitPrayerRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const prayerData = req.body;
            const userId = req.user?.id;

            // Create prayer request
            const prayerRequest = await prisma.prayerRequest.create({
                data: {
                    title: prayerData.title,
                    description: prayerData.description,
                    category: prayerData.category,
                    isAnonymous: prayerData.isAnonymous || false,
                    isPublic: prayerData.isPublic || false,
                    userId: userId || null,
                },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });

            // Send notification to prayer team if user is logged in
            if (userId) {
                const prayerTeam = await prisma.user.findMany({
                    where: {
                        role: { in: ['PASTOR', 'LEADER'] },
                        emailVerified: true,
                    },
                    select: {
                        email: true,
                        firstName: true,
                    },
                });

                if (prayerTeam.length > 0) {
                    const emails = prayerTeam.map(member => member.email);

                    await sendEmail({
                        to: emails,
                        subject: 'New Prayer Request - GracePoint Church',
                        template: 'prayer-request-notification',
                        data: {
                            prayerRequest: {
                                title: prayerRequest.title,
                                description: prayerRequest.description,
                                category: prayerRequest.category,
                            },
                            requesterName: prayerRequest.isAnonymous
                                ? 'Anonymous'
                                : `${prayerRequest.user?.firstName} ${prayerRequest.user?.lastName}`,
                            viewUrl: `${process.env.FRONTEND_URL}/prayer/${prayerRequest.id}`,
                        },
                    });
                }
            }

            res.status(201).json({
                status: 'success',
                message: 'Prayer request submitted successfully',
                data: {
                    prayerRequest: {
                        id: prayerRequest.id,
                        title: prayerRequest.title,
                        isAnonymous: prayerRequest.isAnonymous,
                        isPublic: prayerRequest.isPublic,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    // Protected methods
    static async getMyPrayerRequests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const {
                page = 1,
                limit = 20,
                status,
                category,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = { userId };

            if (status) filter.status = status;
            if (category) filter.category = category;

            // Get total count
            const total = await prisma.prayerRequest.count({ where: filter });

            // Get prayers
            const prayers = await prisma.prayerRequest.findMany({
                where: filter,
                include: {
                    _count: {
                        select: {
                            prayedBy: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    prayers,
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

    static async createPrayerRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const prayerData = req.body;

            const prayerRequest = await prisma.prayerRequest.create({
                data: {
                    ...prayerData,
                    userId,
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Prayer request created successfully',
                data: { prayerRequest },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateMyPrayerRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;
            const updateData = req.body;

            // Verify ownership
            const existingRequest = await prisma.prayerRequest.findFirst({
                where: {
                    id: requestId,
                    userId,
                },
            });

            if (!existingRequest) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer request not found',
                });
                return;
            }

            const prayerRequest = await prisma.prayerRequest.update({
                where: { id: requestId },
                data: updateData,
            });

            res.status(200).json({
                status: 'success',
                message: 'Prayer request updated successfully',
                data: { prayerRequest },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteMyPrayerRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;

            // Verify ownership
            const existingRequest = await prisma.prayerRequest.findFirst({
                where: {
                    id: requestId,
                    userId,
                },
            });

            if (!existingRequest) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer request not found',
                });
                return;
            }

            await prisma.prayerRequest.delete({
                where: { id: requestId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Prayer request deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPrayerWall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const {
                page = 1,
                limit = 20,
                category,
                status,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter - show public prayers or user's own prayers
            const filter: any = {
                OR: [
                    { isPublic: true },
                    { userId },
                ],
                status: { in: ['PENDING', 'PRAYED'] },
            };

            if (category) filter.category = category;
            if (status) filter.status = status;

            // Get total count
            const total = await prisma.prayerRequest.count({ where: filter });

            // Get prayers
            const prayers = await prisma.prayerRequest.findMany({
                where: filter,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    status: true,
                    isAnonymous: true,
                    isPublic: true,
                    createdAt: true,
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            avatar: true,
                        },
                    },
                    prayedBy: {
                        where: { id: userId },
                        select: { id: true },
                    },
                    _count: {
                        select: {
                            prayedBy: true,
                        },
                    },
                },
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            // Format response
            const formattedPrayers = prayers.map(prayer => ({
                id: prayer.id,
                title: prayer.title,
                description: prayer.description,
                category: prayer.category,
                status: prayer.status,
                isAnonymous: prayer.isAnonymous,
                isPublic: prayer.isPublic,
                createdAt: prayer.createdAt,
                requester: prayer.isAnonymous
                    ? null
                    : {
                        id: prayer.user?.id,
                        name: `${prayer.user?.firstName} ${prayer.user?.lastName}`,
                        avatar: prayer.user?.avatar,
                    },
                prayerCount: prayer._count.prayedBy,
                prayedByMe: prayer.prayedBy.length > 0,
            }));

            res.status(200).json({
                status: 'success',
                data: {
                    prayers: formattedPrayers,
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

    static async getPrayerRequestById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;

            const prayerRequest = await prisma.prayerRequest.findFirst({
                where: {
                    id: requestId,
                    OR: [
                        { isPublic: true },
                        { userId },
                    ],
                },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    status: true,
                    isAnonymous: true,
                    isPublic: true,
                    createdAt: true,
                    updatedAt: true,
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            avatar: true,
                        },
                    },
                    prayedBy: {
                        where: { id: userId },
                        select: { id: true },
                    },
                    _count: {
                        select: {
                            prayedBy: true,
                        },
                    },
                },
            });

            if (!prayerRequest) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer request not found',
                });
                return;
            }

            const formattedPrayer = {
                ...prayerRequest,
                requester: prayerRequest.isAnonymous
                    ? null
                    : {
                        id: prayerRequest.user?.id,
                        name: `${prayerRequest.user?.firstName} ${prayerRequest.user?.lastName}`,
                        avatar: prayerRequest.user?.avatar,
                    },
                prayerCount: prayerRequest._count.prayedBy,
                prayedByMe: prayerRequest.prayedBy.length > 0,
            };

            delete (formattedPrayer as any).user;
            delete (formattedPrayer as any).prayedBy;
            delete (formattedPrayer as any)._count;

            res.status(200).json({
                status: 'success',
                data: { prayerRequest: formattedPrayer },
            });
        } catch (error) {
            next(error);
        }
    }

    static async prayForRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;
            const { notes } = req.body;

            // Check if prayer request exists and is accessible
            const prayerRequest = await prisma.prayerRequest.findFirst({
                where: {
                    id: requestId,
                    OR: [
                        { isPublic: true },
                        { userId },
                    ],
                },
            });

            if (!prayerRequest) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer request not found',
                });
                return;
            }

            // Check if already prayed for
            const existingPrayer = await prisma.prayerRecord.findUnique({
                where: {
                    prayerRequestId_userId: {
                        prayerRequestId: requestId,
                        userId,
                    },
                },
            });

            if (existingPrayer) {
                res.status(400).json({
                    status: 'error',
                    message: 'Already prayed for this request',
                });
                return;
            }

            // Create prayer record
            const prayerRecord = await prisma.prayerRecord.create({
                data: {
                    prayerRequestId: requestId,
                    userId,
                    notes,
                },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            avatar: true,
                        },
                    },
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Prayer recorded',
                data: { prayerRecord },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPrayerRequestPrayers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;

            // Check if prayer request exists and is accessible
            const prayerRequest = await prisma.prayerRequest.findFirst({
                where: {
                    id: requestId,
                    OR: [
                        { isPublic: true },
                        { userId },
                    ],
                },
            });

            if (!prayerRequest) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer request not found',
                });
                return;
            }

            const prayers = await prisma.prayerRecord.findMany({
                where: { prayerRequestId: requestId },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            avatar: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            res.status(200).json({
                status: 'success',
                data: { prayers },
            });
        } catch (error) {
            next(error);
        }
    }

    // Prayer groups
    static async getPrayerGroups(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;

            const groups = await prisma.group.findMany({
                where: {
                    type: 'PRAYER',
                    OR: [
                        { isPrivate: false },
                        {
                            members: {
                                some: { userId },
                            },
                        },
                    ],
                },
                include: {
                    leader: {
                        select: {
                            firstName: true,
                            lastName: true,
                        },
                    },
                    _count: {
                        select: {
                            members: true,
                        },
                    },
                    members: {
                        where: { userId },
                        select: { role: true },
                    },
                },
                orderBy: { name: 'asc' },
            });

            const formattedGroups = groups.map(group => ({
                id: group.id,
                name: group.name,
                description: group.description,
                meetingDay: group.meetingDay,
                meetingTime: group.meetingTime,
                location: group.location,
                isPrivate: group.isPrivate,
                leader: group.leader,
                memberCount: group._count.members,
                myRole: group.members[0]?.role || null,
                isMember: group.members.length > 0,
            }));

            res.status(200).json({
                status: 'success',
                data: { groups: formattedGroups },
            });
        } catch (error) {
            next(error);
        }
    }

    static async createPrayerGroup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const groupData = req.body;

            const group = await prisma.group.create({
                data: {
                    ...groupData,
                    type: 'PRAYER',
                    leaderId: userId,
                },
            });

            // Add creator as leader
            await prisma.groupMember.create({
                data: {
                    groupId: group.id,
                    userId,
                    role: 'LEADER',
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Prayer group created successfully',
                data: { group },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPrayerGroupById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { groupId } = req.params;

            const group = await prisma.group.findFirst({
                where: {
                    id: groupId,
                    type: 'PRAYER',
                    OR: [
                        { isPrivate: false },
                        {
                            members: {
                                some: { userId },
                            },
                        },
                    ],
                },
                include: {
                    leader: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    members: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    firstName: true,
                                    lastName: true,
                                    avatar: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!group) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer group not found',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: { group },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updatePrayerGroup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { groupId } = req.params;
            const updateData = req.body;

            // Verify user is the group leader
            const group = await prisma.group.findFirst({
                where: {
                    id: groupId,
                    leaderId: userId,
                    type: 'PRAYER',
                },
            });

            if (!group) {
                res.status(403).json({
                    status: 'error',
                    message: 'Not authorized to update this group',
                });
                return;
            }

            const updatedGroup = await prisma.group.update({
                where: { id: groupId },
                data: updateData,
            });

            res.status(200).json({
                status: 'success',
                message: 'Prayer group updated successfully',
                data: { group: updatedGroup },
            });
        } catch (error) {
            next(error);
        }
    }

    static async joinPrayerGroup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { groupId } = req.params;

            // Check if group exists and is joinable
            const group = await prisma.group.findFirst({
                where: {
                    id: groupId,
                    type: 'PRAYER',
                    OR: [
                        { isPrivate: false },
                        // Private groups might require approval
                    ],
                },
            });

            if (!group) {
                res.status(404).json({
                    status: 'error',
                    message: 'Prayer group not found or not joinable',
                });
                return;
            }

            // Check if already a member
            const existingMember = await prisma.groupMember.findUnique({
                where: {
                    groupId_userId: {
                        groupId,
                        userId,
                    },
                },
            });

            if (existingMember) {
                res.status(400).json({
                    status: 'error',
                    message: 'Already a member of this group',
                });
                return;
            }

            // Join group
            const member = await prisma.groupMember.create({
                data: {
                    groupId,
                    userId,
                    role: 'MEMBER',
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Joined prayer group successfully',
                data: { member },
            });
        } catch (error) {
            next(error);
        }
    }

    static async leavePrayerGroup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { groupId } = req.params;

            // Check if member (and not the leader)
            const group = await prisma.group.findFirst({
                where: {
                    id: groupId,
                    leaderId: { not: userId }, // Can't leave if you're the leader
                },
            });

            if (!group) {
                res.status(403).json({
                    status: 'error',
                    message: 'Cannot leave group as leader',
                });
                return;
            }

            await prisma.groupMember.delete({
                where: {
                    groupId_userId: {
                        groupId,
                        userId,
                    },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Left prayer group successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async getAllPrayerRequests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                status,
                category,
                userId,
                startDate,
                endDate,
                isPublic,
                isAnonymous,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {};

            if (status) filter.status = status;
            if (category) filter.category = category;
            if (userId) filter.userId = userId;
            if (isPublic !== undefined) filter.isPublic = isPublic === 'true';
            if (isAnonymous !== undefined) filter.isAnonymous = isAnonymous === 'true';

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            // Get total count
            const total = await prisma.prayerRequest.count({ where: filter });

            // Get prayers
            const prayers = await prisma.prayerRequest.findMany({
                where: filter,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    _count: {
                        select: {
                            prayedBy: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    prayers,
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

    static async updatePrayerRequestStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { requestId } = req.params;
            const { status, response } = req.body;

            const prayerRequest = await prisma.prayerRequest.update({
                where: { id: requestId },
                data: {
                    status,
                    ...(response && { response }),
                },
                include: {
                    user: {
                        select: {
                            email: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });

            // Send notification email if status changed to ANSWERED
            if (status === 'ANSWERED' && prayerRequest.user?.email) {
                await sendEmail({
                    to: prayerRequest.user.email,
                    subject: 'Prayer Request Update - GracePoint Church',
                    template: 'prayer-answered',
                    data: {
                        name: `${prayerRequest.user.firstName} ${prayerRequest.user.lastName}`,
                        prayerTitle: prayerRequest.title,
                        response: response || 'Your prayer has been answered!',
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Prayer request status updated successfully',
                data: { prayerRequest },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deletePrayerRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { requestId } = req.params;

            await prisma.prayerRequest.delete({
                where: { id: requestId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Prayer request deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPrayerAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate } = req.query;

            const filter: any = {};

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            const [
                totalRequests,
                answeredRequests,
                pendingRequests,
                requestsByCategory,
                requestsByMonth,
                totalPrayers,
            ] = await Promise.all([
                prisma.prayerRequest.count({ where: filter }),
                prisma.prayerRequest.count({
                    where: {
                        ...filter,
                        status: 'ANSWERED',
                    },
                }),
                prisma.prayerRequest.count({
                    where: {
                        ...filter,
                        status: 'PENDING',
                    },
                }),
                prisma.prayerRequest.groupBy({
                    by: ['category'],
                    where: filter,
                    _count: true,
                }),
                prisma.prayerRequest.groupBy({
                    by: ['createdAt'],
                    where: filter,
                    _count: true,
                }),
                prisma.prayerRecord.count({
                    where: {
                        prayerRequest: filter,
                    },
                }),
            ]);

            const analytics = {
                totalRequests,
                answeredRequests,
                pendingRequests,
                answerRate: totalRequests > 0 ? Math.round((answeredRequests / totalRequests) * 100) : 0,
                requestsByCategory: requestsByCategory.reduce((acc, item) => {
                    acc[item.category] = item._count;
                    return acc;
                }, {} as Record<string, number>),
                requestsByMonth: requestsByMonth.reduce((acc, item) => {
                    const month = new Date(item.createdAt).toLocaleString('default', { month: 'short' });
                    acc[month] = (acc[month] || 0) + item._count;
                    return acc;
                }, {} as Record<string, number>),
                totalPrayers,
                averagePrayersPerRequest: totalRequests > 0 ? Math.round(totalPrayers / totalRequests) : 0,
            };

            res.status(200).json({
                status: 'success',
                data: { analytics },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getAllPrayerGroups(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const groups = await prisma.group.findMany({
                where: { type: 'PRAYER' },
                include: {
                    leader: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    _count: {
                        select: {
                            members: true,
                        },
                    },
                },
                orderBy: { name: 'asc' },
            });

            res.status(200).json({
                status: 'success',
                data: { groups },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deletePrayerGroup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { groupId } = req.params;

            await prisma.group.delete({
                where: { id: groupId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Prayer group deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }
}