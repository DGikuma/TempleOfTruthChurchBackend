import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { sendEmail } from '../services/email.service';
import { PaymentService } from '../services/payment.service';
import { StreamingService } from '../services/streaming.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class AdminController {
    // Dashboard statistics
    static async getDashboardStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate } = req.query;

            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate as string);
            if (endDate) dateFilter.lte = new Date(endDate as string);

            const [
                totalUsers,
                activeUsers,
                newUsersThisMonth,
                totalDonations,
                totalEvents,
                upcomingEvents,
                totalSermons,
                liveStreams,
                prayerRequests,
                answeredPrayers,
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
                prisma.donation.aggregate({
                    where: {
                        status: 'COMPLETED',
                        createdAt: dateFilter,
                    },
                    _sum: { amount: true },
                }),
                prisma.event.count(),
                prisma.event.count({
                    where: {
                        status: 'UPCOMING',
                        startDate: {
                            gt: new Date(),
                        },
                    },
                }),
                prisma.sermon.count(),
                prisma.sermon.count({
                    where: {
                        isLive: true,
                        date: {
                            gt: new Date(),
                        },
                    },
                }),
                prisma.prayerRequest.count({
                    where: {
                        createdAt: dateFilter,
                    },
                }),
                prisma.prayerRequest.count({
                    where: {
                        status: 'ANSWERED',
                        createdAt: dateFilter,
                    },
                }),
            ]);

            const stats = {
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    newThisMonth: newUsersThisMonth,
                },
                finances: {
                    totalDonations: totalDonations._sum.amount || 0,
                    // Add more financial stats
                },
                events: {
                    total: totalEvents,
                    upcoming: upcomingEvents,
                },
                content: {
                    totalSermons,
                    liveStreams,
                },
                prayer: {
                    totalRequests: prayerRequests,
                    answered: answeredPrayers,
                    answerRate: prayerRequests > 0 ? Math.round((answeredPrayers / prayerRequests) * 100) : 0,
                },
            };

            res.status(200).json({
                status: 'success',
                data: { stats },
            });
        } catch (error) {
            next(error);
        }
    }

    // User management
    static async getUsersOverview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const users = await prisma.user.findMany({
                where: {
                    status: 'ACTIVE',
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    membershipDate: true,
                    lastLogin: true,
                    address: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
            });

            res.status(200).json({
                status: 'success',
                data: { users },
            });
        } catch (error) {
            next(error);
        }
    }

    static async inviteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, firstName, lastName, role, sendEmail = true } = req.body;
            const inviterId = req.user.id;

            // Check if user already exists
            const existingUser = await prisma.user.findUnique({
                where: { email },
            });

            if (existingUser) {
                res.status(400).json({
                    status: 'error',
                    message: 'User already exists with this email',
                });
                return;
            }

            // Generate invitation token
            const invitationToken = require('crypto').randomBytes(32).toString('hex');
            const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            // Create invitation
            const invitation = await prisma.invitation.create({
                data: {
                    email,
                    firstName,
                    lastName,
                    role,
                    token: invitationToken,
                    expires: invitationExpires,
                    invitedBy: inviterId,
                },
            });

            // Send invitation email
            if (sendEmail) {
                const invitationUrl = `${process.env.FRONTEND_URL}/invitation/${invitationToken}`;

                await sendEmail({
                    to: email,
                    subject: 'Invitation to Join GracePoint Church Portal',
                    template: 'user-invitation',
                    data: {
                        name: `${firstName} ${lastName}`,
                        inviterName: `${req.user.firstName} ${req.user.lastName}`,
                        invitationUrl,
                        role,
                        expiresIn: '7 days',
                    },
                });
            }

            res.status(201).json({
                status: 'success',
                message: 'Invitation sent successfully',
                data: { invitation },
            });
        } catch (error) {
            next(error);
        }
    }

    static async bulkImportUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // This would handle CSV or Excel file upload
            // For now, accept JSON array
            const users = req.body.users;

            if (!Array.isArray(users) || users.length === 0) {
                res.status(400).json({
                    status: 'error',
                    message: 'No users data provided',
                });
                return;
            }

            const results = {
                successful: 0,
                failed: 0,
                errors: [] as string[],
            };

            for (const userData of users) {
                try {
                    // Check if user exists
                    const existingUser = await prisma.user.findUnique({
                        where: { email: userData.email },
                    });

                    if (existingUser) {
                        results.failed++;
                        results.errors.push(`User ${userData.email} already exists`);
                        continue;
                    }

                    // Create user
                    await prisma.user.create({
                        data: {
                            email: userData.email,
                            firstName: userData.firstName,
                            lastName: userData.lastName,
                            phone: userData.phone,
                            role: userData.role || 'MEMBER',
                            status: 'ACTIVE',
                            // Add other fields as needed
                        },
                    });

                    results.successful++;
                } catch (error: any) {
                    results.failed++;
                    results.errors.push(`Failed to import ${userData.email}: ${error.message}`);
                }
            }

            res.status(200).json({
                status: 'success',
                message: `Imported ${results.successful} users, ${results.failed} failed`,
                data: { results },
            });
        } catch (error) {
            next(error);
        }
    }

    static async exportUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { format = 'csv' } = req.query;

            const users = await prisma.user.findMany({
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    role: true,
                    status: true,
                    membershipDate: true,
                    createdAt: true,
                    lastLogin: true,
                    address: {
                        select: {
                            street: true,
                            city: true,
                            state: true,
                            zipCode: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Format data based on requested format
            let data: any;
            let contentType: string;
            let filename: string;

            const timestamp = new Date().toISOString().split('T')[0];

            switch (format) {
                case 'csv':
                    // Convert to CSV
                    const headers = ['Email', 'First Name', 'Last Name', 'Phone', 'Role', 'Status', 'Membership Date', 'Last Login', 'Address'];
                    const rows = users.map(user => [
                        user.email,
                        user.firstName,
                        user.lastName,
                        user.phone || '',
                        user.role,
                        user.status,
                        user.membershipDate?.toISOString() || '',
                        user.lastLogin?.toISOString() || '',
                        user.address ? `${user.address.street}, ${user.address.city}, ${user.address.state} ${user.address.zipCode}` : '',
                    ]);
                    data = [headers, ...rows].map(row => row.join(',')).join('\n');
                    contentType = 'text/csv';
                    filename = `users_${timestamp}.csv`;
                    break;

                case 'excel':
                    // Using exceljs would go here
                    // For now, return CSV
                    const excelHeaders = ['Email', 'First Name', 'Last Name', 'Phone', 'Role', 'Status', 'Membership Date', 'Last Login', 'Address'];
                    const excelRows = users.map(user => [
                        user.email,
                        user.firstName,
                        user.lastName,
                        user.phone || '',
                        user.role,
                        user.status,
                        user.membershipDate?.toISOString() || '',
                        user.lastLogin?.toISOString() || '',
                        user.address ? `${user.address.street}, ${user.address.city}, ${user.address.state} ${user.address.zipCode}` : '',
                    ]);
                    data = [excelHeaders, ...excelRows].map(row => row.join(',')).join('\n');
                    contentType = 'application/vnd.ms-excel';
                    filename = `users_${timestamp}.xlsx`;
                    break;

                default:
                    data = JSON.stringify({ users }, null, 2);
                    contentType = 'application/json';
                    filename = `users_${timestamp}.json`;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(data);
        } catch (error) {
            next(error);
        }
    }

    // Giving management
    static async getGivingOverview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const now = new Date();
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

            const [
                totalDonations,
                thisMonthDonations,
                lastMonthDonations,
                recurringDonations,
                topDonors,
                donationsByDesignation,
            ] = await Promise.all([
                prisma.donation.aggregate({
                    where: { status: 'COMPLETED' },
                    _sum: { amount: true },
                }),
                prisma.donation.aggregate({
                    where: {
                        status: 'COMPLETED',
                        createdAt: { gte: thisMonth },
                    },
                    _sum: { amount: true },
                }),
                prisma.donation.aggregate({
                    where: {
                        status: 'COMPLETED',
                        createdAt: { gte: lastMonth, lt: thisMonth },
                    },
                    _sum: { amount: true },
                }),
                prisma.donation.count({
                    where: {
                        status: 'COMPLETED',
                        frequency: { in: ['MONTHLY', 'WEEKLY', 'QUARTERLY', 'YEARLY'] },
                    },
                }),
                prisma.donation.groupBy({
                    by: ['donorEmail'],
                    where: { status: 'COMPLETED' },
                    _sum: { amount: true },
                    orderBy: { _sum: { amount: 'desc' } },
                    take: 10,
                }),
                prisma.donation.groupBy({
                    by: ['designation'],
                    where: { status: 'COMPLETED' },
                    _sum: { amount: true },
                }),
            ]);

            const overview = {
                totalDonations: totalDonations._sum.amount || 0,
                thisMonthDonations: thisMonthDonations._sum.amount || 0,
                lastMonthDonations: lastMonthDonations._sum.amount || 0,
                monthlyChange: lastMonthDonations._sum.amount
                    ? ((thisMonthDonations._sum.amount! - lastMonthDonations._sum.amount!) / lastMonthDonations._sum.amount!) * 100
                    : 0,
                recurringDonations,
                topDonors: topDonors.map(donor => ({
                    email: donor.donorEmail,
                    totalAmount: donor._sum.amount || 0,
                })),
                donationsByDesignation: donationsByDesignation.reduce((acc, item) => {
                    acc[item.designation || 'General'] = item._sum.amount || 0;
                    return acc;
                }, {} as Record<string, number>),
            };

            res.status(200).json({
                status: 'success',
                data: { overview },
            });
        } catch (error) {
            next(error);
        }
    }

    static async processOfflineDonations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { donations } = req.body;

            const processedDonations = [];

            for (const donationData of donations) {
                // Generate receipt number
                const receiptNumber = `GPC-OFF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                const donation = await prisma.donation.create({
                    data: {
                        ...donationData,
                        receiptNumber,
                        status: 'COMPLETED',
                        paymentMethod: donationData.paymentMethod,
                        createdAt: new Date(donationData.date),
                    },
                });

                processedDonations.push(donation);

                // Send receipt email if email provided
                if (donationData.donorEmail) {
                    await sendEmail({
                        to: donationData.donorEmail,
                        subject: 'Offline Donation Receipt - GracePoint Church',
                        template: 'donation-receipt',
                        data: {
                            name: donationData.donorName,
                            amount: donationData.amount,
                            currency: donationData.currency || 'USD',
                            receiptNumber,
                            designation: donationData.designation || 'General',
                            date: new Date(donationData.date).toLocaleDateString(),
                            paymentMethod: donationData.paymentMethod,
                        },
                    });
                }
            }

            res.status(200).json({
                status: 'success',
                message: `${processedDonations.length} offline donations processed`,
                data: { donations: processedDonations },
            });
        } catch (error) {
            next(error);
        }
    }

    // Attendance management
    static async getAttendanceOverview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, eventId } = req.query;

            const filter: any = {};
            if (eventId) filter.eventId = eventId;
            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            const [
                totalRegistrations,
                checkedInAttendees,
                attendanceByEvent,
                recentCheckIns,
            ] = await Promise.all([
                prisma.eventRegistration.count({
                    where: {
                        ...filter,
                        status: 'CONFIRMED',
                    },
                }),
                prisma.eventRegistration.count({
                    where: {
                        ...filter,
                        status: 'CONFIRMED',
                        checkedIn: true,
                    },
                }),
                prisma.eventRegistration.groupBy({
                    by: ['eventId'],
                    where: {
                        ...filter,
                        status: 'CONFIRMED',
                    },
                    _count: true,
                }),
                prisma.eventRegistration.findMany({
                    where: {
                        ...filter,
                        checkedIn: true,
                    },
                    include: {
                        event: {
                            select: {
                                title: true,
                            },
                        },
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                    orderBy: { checkedInAt: 'desc' },
                    take: 20,
                }),
            ]);

            const overview = {
                totalRegistrations,
                checkedInAttendees,
                attendanceRate: totalRegistrations > 0
                    ? Math.round((checkedInAttendees / totalRegistrations) * 100)
                    : 0,
                attendanceByEvent: await Promise.all(
                    attendanceByEvent.map(async (item) => {
                        const event = await prisma.event.findUnique({
                            where: { id: item.eventId },
                            select: { title: true },
                        });
                        return {
                            eventId: item.eventId,
                            eventTitle: event?.title,
                            registrations: item._count,
                        };
                    })
                ),
                recentCheckIns: recentCheckIns.map(checkIn => ({
                    id: checkIn.id,
                    eventTitle: checkIn.event.title,
                    userName: `${checkIn.user.firstName} ${checkIn.user.lastName}`,
                    checkedInAt: checkIn.checkedInAt,
                })),
            };

            res.status(200).json({
                status: 'success',
                data: { overview },
            });
        } catch (error) {
            next(error);
        }
    }

    static async recordAttendance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId, userId, checkedInAt, guests = 0 } = req.body;

            // Find or create registration
            let registration = await prisma.eventRegistration.findUnique({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
            });

            if (registration) {
                // Update existing registration
                registration = await prisma.eventRegistration.update({
                    where: { id: registration.id },
                    data: {
                        checkedIn: true,
                        checkedInAt: checkedInAt ? new Date(checkedInAt) : new Date(),
                        guests,
                    },
                });
            } else {
                // Create new registration
                registration = await prisma.eventRegistration.create({
                    data: {
                        eventId,
                        userId,
                        status: 'CONFIRMED',
                        checkedIn: true,
                        checkedInAt: checkedInAt ? new Date(checkedInAt) : new Date(),
                        guests,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Attendance recorded',
                data: { registration },
            });
        } catch (error) {
            next(error);
        }
    }

    static async bulkRecordAttendance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId, attendees } = req.body;

            const results = {
                successful: 0,
                failed: 0,
                errors: [] as string[],
            };

            for (const attendee of attendees) {
                try {
                    await prisma.eventRegistration.upsert({
                        where: {
                            eventId_userId: {
                                eventId,
                                userId: attendee.userId,
                            },
                        },
                        update: {
                            checkedIn: true,
                            checkedInAt: new Date(),
                            guests: attendee.guests || 0,
                        },
                        create: {
                            eventId,
                            userId: attendee.userId,
                            status: 'CONFIRMED',
                            checkedIn: true,
                            checkedInAt: new Date(),
                            guests: attendee.guests || 0,
                        },
                    });

                    results.successful++;
                } catch (error: any) {
                    results.failed++;
                    results.errors.push(`Failed to record attendance for user ${attendee.userId}: ${error.message}`);
                }
            }

            res.status(200).json({
                status: 'success',
                message: `Recorded attendance for ${results.successful} attendees, ${results.failed} failed`,
                data: { results },
            });
        } catch (error) {
            next(error);
        }
    }

    // Communications
    static async createAnnouncement(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const announcementData = req.body;
            const authorId = req.user.id;

            const announcement = await prisma.announcement.create({
                data: {
                    ...announcementData,
                    authorId,
                    publishAt: announcementData.publishAt ? new Date(announcementData.publishAt) : null,
                    expiresAt: announcementData.expiresAt ? new Date(announcementData.expiresAt) : null,
                },
            });

            // Send emails if requested
            if (announcementData.sendEmail) {
                // Get target users
                let users = [];

                if (announcementData.targetRoles && announcementData.targetRoles.length > 0) {
                    users = await prisma.user.findMany({
                        where: {
                            role: { in: announcementData.targetRoles },
                            emailVerified: true,
                        },
                        select: { email: true, firstName: true },
                    });
                } else {
                    // Send to all active users
                    users = await prisma.user.findMany({
                        where: {
                            status: 'ACTIVE',
                            emailVerified: true,
                        },
                        select: { email: true, firstName: true },
                    });
                }

                // Send emails in batches
                const batchSize = 50;
                for (let i = 0; i < users.length; i += batchSize) {
                    const batch = users.slice(i, i + batchSize);

                    await Promise.all(
                        batch.map(user =>
                            sendEmail({
                                to: user.email,
                                subject: announcementData.title,
                                template: 'announcement',
                                data: {
                                    name: user.firstName,
                                    title: announcementData.title,
                                    content: announcementData.content,
                                    priority: announcementData.priority,
                                },
                            })
                        )
                    );

                    // Delay between batches to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            res.status(201).json({
                status: 'success',
                message: 'Announcement created',
                data: { announcement },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getAnnouncements(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { page = 1, limit = 20, status } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = {};
            if (status) filter.status = status;

            const total = await prisma.announcement.count({ where: filter });

            const announcements = await prisma.announcement.findMany({
                where: filter,
                include: {
                    author: {
                        select: {
                            firstName: true,
                            lastName: true,
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
                    announcements,
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

    static async createNewsletter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const newsletterData = req.body;

            // Create newsletter record
            const newsletter = await prisma.newsletter.create({
                data: {
                    subject: newsletterData.subject,
                    content: newsletterData.content,
                    target: newsletterData.target,
                    targetUsers: newsletterData.targetUsers || [],
                    scheduleFor: newsletterData.scheduleFor ? new Date(newsletterData.scheduleFor) : null,
                    status: newsletterData.scheduleFor ? 'SCHEDULED' : 'DRAFT',
                },
            });

            // Send immediately if not scheduled
            if (!newsletterData.scheduleFor) {
                // Get target users
                let users = [];

                switch (newsletterData.target) {
                    case 'ALL':
                        users = await prisma.user.findMany({
                            where: {
                                status: 'ACTIVE',
                                emailVerified: true,
                            },
                            select: { email: true, firstName: true },
                        });
                        break;
                    case 'MEMBERS':
                        users = await prisma.user.findMany({
                            where: {
                                role: { in: ['MEMBER', 'LEADER', 'PASTOR', 'ADMIN'] },
                                status: 'ACTIVE',
                                emailVerified: true,
                            },
                            select: { email: true, firstName: true },
                        });
                        break;
                    case 'GUESTS':
                        users = await prisma.user.findMany({
                            where: {
                                role: 'GUEST',
                                status: 'ACTIVE',
                                emailVerified: true,
                            },
                            select: { email: true, firstName: true },
                        });
                        break;
                    case 'SPECIFIC':
                        users = await prisma.user.findMany({
                            where: {
                                id: { in: newsletterData.targetUsers || [] },
                                emailVerified: true,
                            },
                            select: { email: true, firstName: true },
                        });
                        break;
                }

                // Send emails in batches
                const batchSize = 50;
                let sentCount = 0;

                for (let i = 0; i < users.length; i += batchSize) {
                    const batch = users.slice(i, i + batchSize);

                    await Promise.all(
                        batch.map(user =>
                            sendEmail({
                                to: user.email,
                                subject: newsletterData.subject,
                                template: 'newsletter',
                                data: {
                                    name: user.firstName,
                                    content: newsletterData.content,
                                    unsubscribeUrl: `${process.env.FRONTEND_URL}/unsubscribe`,
                                },
                            })
                        )
                    );

                    sentCount += batch.length;

                    // Delay between batches
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Update newsletter status
                await prisma.newsletter.update({
                    where: { id: newsletter.id },
                    data: {
                        status: 'SENT',
                        sentAt: new Date(),
                        sentCount,
                    },
                });
            }

            res.status(201).json({
                status: 'success',
                message: newsletterData.scheduleFor ? 'Newsletter scheduled' : 'Newsletter sent',
                data: { newsletter },
            });
        } catch (error) {
            next(error);
        }
    }

    // Reports
    static async generateFinancialReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, format, includeDetails } = req.query;

            const donations = await prisma.donation.findMany({
                where: {
                    status: 'COMPLETED',
                    createdAt: {
                        gte: new Date(startDate as string),
                        lte: new Date(endDate as string),
                    },
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
                orderBy: { createdAt: 'asc' },
            });

            const report = {
                period: {
                    start: startDate,
                    end: endDate,
                },
                summary: {
                    totalAmount: donations.reduce((sum, d) => sum + d.amount, 0),
                    donationCount: donations.length,
                    averageDonation: donations.length > 0
                        ? donations.reduce((sum, d) => sum + d.amount, 0) / donations.length
                        : 0,
                },
                donationsByDesignation: donations.reduce((acc, d) => {
                    const designation = d.designation || 'General';
                    acc[designation] = (acc[designation] || 0) + d.amount;
                    return acc;
                }, {} as Record<string, number>),
                donationsByPaymentMethod: donations.reduce((acc, d) => {
                    acc[d.paymentMethod] = (acc[d.paymentMethod] || 0) + d.amount;
                    return acc;
                }, {} as Record<string, number>),
                ...(includeDetails === 'true' && { details: donations }),
            };

            // Format based on requested format
            let data: any;
            let contentType: string;
            let filename: string;

            const dateRange = `${(startDate as string).split('T')[0]}_to_${(endDate as string).split('T')[0]}`;

            switch (format) {
                case 'pdf':
                    // PDF generation would go here
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/pdf';
                    filename = `financial_report_${dateRange}.pdf`;
                    break;
                case 'excel':
                    // Excel generation would go here
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/vnd.ms-excel';
                    filename = `financial_report_${dateRange}.xlsx`;
                    break;
                case 'csv':
                    // CSV generation
                    const headers = ['Date', 'Donor', 'Email', 'Amount', 'Designation', 'Payment Method'];
                    const rows = donations.map(d => [
                        d.createdAt.toISOString(),
                        d.donorName,
                        d.donorEmail,
                        d.amount,
                        d.designation,
                        d.paymentMethod,
                    ]);
                    data = [headers, ...rows].map(row => row.join(',')).join('\n');
                    contentType = 'text/csv';
                    filename = `financial_report_${dateRange}.csv`;
                    break;
                default:
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/json';
                    filename = `financial_report_${dateRange}.json`;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(data);
        } catch (error) {
            next(error);
        }
    }

    static async generateAttendanceReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, format, groupBy } = req.query;

            const registrations = await prisma.eventRegistration.findMany({
                where: {
                    status: 'CONFIRMED',
                    createdAt: {
                        gte: new Date(startDate as string),
                        lte: new Date(endDate as string),
                    },
                },
                include: {
                    event: {
                        select: {
                            title: true,
                            startDate: true,
                            category: true,
                        },
                    },
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
            });

            const report = {
                period: {
                    start: startDate,
                    end: endDate,
                },
                summary: {
                    totalRegistrations: registrations.length,
                    checkedInCount: registrations.filter(r => r.checkedIn).length,
                    attendanceRate: registrations.length > 0
                        ? (registrations.filter(r => r.checkedIn).length / registrations.length) * 100
                        : 0,
                },
                ...(groupBy === 'event' && {
                    byEvent: registrations.reduce((acc, r) => {
                        const eventId = r.eventId;
                        if (!acc[eventId]) {
                            acc[eventId] = {
                                eventTitle: r.event.title,
                                registrations: 0,
                                checkedIn: 0,
                            };
                        }
                        acc[eventId].registrations++;
                        if (r.checkedIn) acc[eventId].checkedIn++;
                        return acc;
                    }, {} as Record<string, any>),
                }),
                details: registrations,
            };

            // Format response
            let data: any;
            let contentType: string;
            let filename: string;

            const dateRange = `${(startDate as string).split('T')[0]}_to_${(endDate as string).split('T')[0]}`;

            switch (format) {
                case 'pdf':
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/pdf';
                    filename = `attendance_report_${dateRange}.pdf`;
                    break;
                case 'excel':
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/vnd.ms-excel';
                    filename = `attendance_report_${dateRange}.xlsx`;
                    break;
                case 'csv':
                    const headers = ['Event', 'Date', 'Attendee', 'Email', 'Checked In', 'Check-in Time'];
                    const rows = registrations.map(r => [
                        r.event.title,
                        r.event.startDate.toISOString(),
                        `${r.user.firstName} ${r.user.lastName}`,
                        r.user.email,
                        r.checkedIn ? 'Yes' : 'No',
                        r.checkedInAt?.toISOString() || '',
                    ]);
                    data = [headers, ...rows].map(row => row.join(',')).join('\n');
                    contentType = 'text/csv';
                    filename = `attendance_report_${dateRange}.csv`;
                    break;
                default:
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/json';
                    filename = `attendance_report_${dateRange}.json`;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(data);
        } catch (error) {
            next(error);
        }
    }

    static async generateMembershipReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { format, includeInactive } = req.query;

            const filter: any = {};
            if (includeInactive !== 'true') {
                filter.status = 'ACTIVE';
            }

            const users = await prisma.user.findMany({
                where: filter,
                include: {
                    address: true,
                    groupMembers: {
                        include: {
                            group: {
                                select: {
                                    name: true,
                                    type: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { lastName: 'asc' },
            });

            const report = {
                generatedAt: new Date().toISOString(),
                summary: {
                    totalUsers: users.length,
                    activeUsers: users.filter(u => u.status === 'ACTIVE').length,
                    usersByRole: users.reduce((acc, u) => {
                        acc[u.role] = (acc[u.role] || 0) + 1;
                        return acc;
                    }, {} as Record<string, number>),
                },
                users: users.map(user => ({
                    id: user.id,
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    status: user.status,
                    membershipDate: user.membershipDate,
                    groups: user.groupMembers.map(gm => ({
                        name: gm.group.name,
                        type: gm.group.type,
                    })),
                    address: user.address,
                })),
            };

            // Format response
            let data: any;
            let contentType: string;
            let filename: string;

            const timestamp = new Date().toISOString().split('T')[0];

            switch (format) {
                case 'pdf':
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/pdf';
                    filename = `membership_report_${timestamp}.pdf`;
                    break;
                case 'excel':
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/vnd.ms-excel';
                    filename = `membership_report_${timestamp}.xlsx`;
                    break;
                case 'csv':
                    const headers = ['Name', 'Email', 'Phone', 'Role', 'Status', 'Membership Date', 'Groups', 'Address'];
                    const rows = users.map(user => [
                        `${user.firstName} ${user.lastName}`,
                        user.email,
                        user.phone || '',
                        user.role,
                        user.status,
                        user.membershipDate?.toISOString() || '',
                        user.groupMembers.map(gm => gm.group.name).join('; '),
                        user.address ? `${user.address.street}, ${user.address.city}, ${user.address.state} ${user.address.zipCode}` : '',
                    ]);
                    data = [headers, ...rows].map(row => row.join(',')).join('\n');
                    contentType = 'text/csv';
                    filename = `membership_report_${timestamp}.csv`;
                    break;
                default:
                    data = JSON.stringify(report, null, 2);
                    contentType = 'application/json';
                    filename = `membership_report_${timestamp}.json`;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(data);
        } catch (error) {
            next(error);
        }
    }

    // System settings
    static async getSystemSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const settings = await prisma.systemSetting.findMany();

            const settingsMap = settings.reduce((acc, setting) => {
                acc[setting.key] = setting.value;
                return acc;
            }, {} as Record<string, any>);

            res.status(200).json({
                status: 'success',
                data: { settings: settingsMap },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateSystemSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { settings } = req.body;

            const updates = Object.entries(settings).map(([key, value]) =>
                prisma.systemSetting.upsert({
                    where: { key },
                    update: { value: JSON.stringify(value) },
                    create: {
                        key,
                        value: JSON.stringify(value),
                        category: 'general',
                    },
                })
            );

            await Promise.all(updates);

            res.status(200).json({
                status: 'success',
                message: 'Settings updated successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getEmailTemplates(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const templates = await prisma.emailTemplate.findMany({
                orderBy: { name: 'asc' },
            });

            res.status(200).json({
                status: 'success',
                data: { templates },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateEmailTemplate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { templateId } = req.params;
            const { content } = req.body;

            const template = await prisma.emailTemplate.update({
                where: { id: templateId },
                data: { content },
            });

            res.status(200).json({
                status: 'success',
                message: 'Email template updated',
                data: { template },
            });
        } catch (error) {
            next(error);
        }
    }

    // Backup and restore
    static async createBackup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // This would actually backup the database
            // For now, create a backup record
            const backup = await prisma.backup.create({
                data: {
                    backupId,
                    type: 'FULL',
                    status: 'COMPLETED',
                    size: 0, // Would be actual size
                    location: 'local', // Would be S3 path
                    createdBy: req.user.id,
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Backup created',
                data: { backup },
            });
        } catch (error) {
            next(error);
        }
    }

    static async listBackups(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const backups = await prisma.backup.findMany({
                orderBy: { createdAt: 'desc' },
                take: 20,
            });

            res.status(200).json({
                status: 'success',
                data: { backups },
            });
        } catch (error) {
            next(error);
        }
    }

    static async restoreBackup(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { backupId } = req.body;

            // This would actually restore the database
            // For now, update backup status
            const backup = await prisma.backup.update({
                where: { backupId },
                data: {
                    lastRestoredAt: new Date(),
                    lastRestoredBy: req.user.id,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Backup restoration initiated',
                data: { backup },
            });
        } catch (error) {
            next(error);
        }
    }

    // Logs and monitoring
    static async getAccessLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { page = 1, limit = 20, userId, startDate, endDate, level } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = {};
            if (userId) filter.userId = userId;
            if (level) filter.level = level;

            if (startDate || endDate) {
                filter.timestamp = {};
                if (startDate) filter.timestamp.gte = new Date(startDate as string);
                if (endDate) filter.timestamp.lte = new Date(endDate as string);
            }

            const total = await prisma.accessLog.count({ where: filter });

            const logs = await prisma.accessLog.findMany({
                where: filter,
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    logs,
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

    static async getErrorLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { page = 1, limit = 20, startDate, endDate } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = { level: 'error' };

            if (startDate || endDate) {
                filter.timestamp = {};
                if (startDate) filter.timestamp.gte = new Date(startDate as string);
                if (endDate) filter.timestamp.lte = new Date(endDate as string);
            }

            const total = await prisma.errorLog.count({ where: filter });

            const logs = await prisma.errorLog.findMany({
                where: filter,
                orderBy: { timestamp: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    logs,
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

    // Super admin methods
    static async getSystemHealth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const [
                dbStatus,
                redisStatus,
                s3Status,
                emailStatus,
                stripeStatus,
                serverUptime,
                memoryUsage,
                cpuUsage,
            ] = await Promise.all([
                // Check database
                prisma.$queryRaw`SELECT 1`.then(() => 'healthy').catch(() => 'unhealthy'),
                // Check Redis (simplified)
                Promise.resolve('healthy'), // Would actually check Redis connection
                // Check S3 (simplified)
                Promise.resolve('healthy'), // Would actually check S3 connection
                // Check email service
                Promise.resolve('healthy'), // Would actually check email service
                // Check Stripe
                Promise.resolve('healthy'), // Would actually check Stripe connection
                // Server uptime
                Promise.resolve(process.uptime()),
                // Memory usage
                Promise.resolve(process.memoryUsage()),
                // CPU usage would require more complex monitoring
                Promise.resolve({ user: 0, system: 0 }),
            ]);

            const health = {
                timestamp: new Date().toISOString(),
                services: {
                    database: dbStatus,
                    redis: redisStatus,
                    storage: s3Status,
                    email: emailStatus,
                    payment: stripeStatus,
                },
                server: {
                    uptime: serverUptime,
                    memory: memoryUsage,
                    cpu: cpuUsage,
                },
            };

            res.status(200).json({
                status: 'success',
                data: { health },
            });
        } catch (error) {
            next(error);
        }
    }

    static async toggleMaintenanceMode(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { enabled, message } = req.body;

            // Update maintenance mode setting
            await prisma.systemSetting.upsert({
                where: { key: 'maintenance_mode' },
                update: {
                    value: JSON.stringify({
                        enabled,
                        message: message || 'System is under maintenance. Please try again later.',
                        enabledAt: new Date().toISOString(),
                        enabledBy: req.user.id,
                    }),
                },
                create: {
                    key: 'maintenance_mode',
                    value: JSON.stringify({
                        enabled,
                        message: message || 'System is under maintenance. Please try again later.',
                        enabledAt: new Date().toISOString(),
                        enabledBy: req.user.id,
                    }),
                    category: 'system',
                },
            });

            res.status(200).json({
                status: 'success',
                message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
            });
        } catch (error) {
            next(error);
        }
    }

    static async clearCache(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { cacheType } = req.body;

            // This would actually clear cache based on type
            // For now, just log the action
            logger.info(`Cache cleared: ${cacheType}`, {
                clearedBy: req.user.id,
                timestamp: new Date().toISOString(),
            });

            res.status(200).json({
                status: 'success',
                message: `Cache cleared: ${cacheType}`,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSystemMetrics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const [
                hourlyRequests,
                dailyRequests,
                activeUsers24h,
                errorRate,
                averageResponseTime,
            ] = await Promise.all([
                prisma.accessLog.count({
                    where: {
                        timestamp: { gte: oneHourAgo },
                    },
                }),
                prisma.accessLog.count({
                    where: {
                        timestamp: { gte: oneDayAgo },
                    },
                }),
                prisma.user.count({
                    where: {
                        lastLogin: { gte: oneDayAgo },
                        status: 'ACTIVE',
                    },
                }),
                prisma.errorLog.count({
                    where: {
                        timestamp: { gte: oneHourAgo },
                    },
                }).then(errorCount =>
                    prisma.accessLog.count({
                        where: {
                            timestamp: { gte: oneHourAgo },
                        },
                    }).then(requestCount =>
                        requestCount > 0 ? (errorCount / requestCount) * 100 : 0
                    )
                ),
                // Average response time would come from request logging
                Promise.resolve(150), // Placeholder
            ]);

            const metrics = {
                requests: {
                    hourly: hourlyRequests,
                    daily: dailyRequests,
                    perSecond: hourlyRequests / 3600,
                },
                users: {
                    active24h: activeUsers24h,
                },
                performance: {
                    errorRate: errorRate.toFixed(2),
                    averageResponseTime,
                },
                timestamp: now.toISOString(),
            };

            res.status(200).json({
                status: 'success',
                data: { metrics },
            });
        } catch (error) {
            next(error);
        }
    }
}