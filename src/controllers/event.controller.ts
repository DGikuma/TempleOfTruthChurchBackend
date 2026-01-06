// src/controllers/event.controller.ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { UploadService } from '../services/upload.service';
import { sendEmail } from '../services/email.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class EventController {
    // Public methods
    static async getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                category,
                status = 'UPCOMING',
                startDate,
                endDate,
                isOnline,
                search,
                sortBy = 'startDate',
                sortOrder = 'asc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {
                status: status === 'UPCOMING' ? { in: ['UPCOMING', 'ONGOING'] } : status,
            };

            if (category) filter.category = category;
            if (isOnline !== undefined) filter.isOnline = isOnline === 'true';
            if (search) {
                filter.OR = [
                    { title: { contains: search as string, mode: 'insensitive' } },
                    { description: { contains: search as string, mode: 'insensitive' } },
                ];
            }

            if (startDate || endDate) {
                filter.startDate = {};
                if (startDate) filter.startDate.gte = new Date(startDate as string);
                if (endDate) filter.startDate.lte = new Date(endDate as string);
            }

            // Get total count
            const total = await prisma.event.count({ where: filter });

            // Get events
            const events = await prisma.event.findMany({
                where: filter,
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    events,
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

    static async getEventById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;

            const event = await prisma.event.findUnique({
                where: { id: eventId },
                include: {
                    registrations: {
                        where: {
                            status: { in: ['CONFIRMED', 'PENDING'] },
                        },
                        select: {
                            id: true,
                            status: true,
                            checkedIn: true,
                            user: {
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

            if (!event) {
                res.status(404).json({
                    status: 'error',
                    message: 'Event not found',
                });
                return;
            }

            // Add registration count
            const eventWithCount = {
                ...event,
                registrationCount: event.registrations.length,
                checkedInCount: event.registrations.filter(r => r.checkedIn).length,
            };

            delete (eventWithCount as any).registrations;

            res.status(200).json({
                status: 'success',
                data: {
                    event: eventWithCount,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    // Protected methods
    static async registerForEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { eventId } = req.params;
            const { guests = 0, notes } = req.body;

            // Get event
            const event = await prisma.event.findUnique({
                where: { id: eventId },
            });

            if (!event) {
                res.status(404).json({
                    status: 'error',
                    message: 'Event not found',
                });
                return;
            }

            // Check if registration is required
            if (event.isRegistrationRequired && event.registrationDeadline) {
                if (new Date() > event.registrationDeadline) {
                    res.status(400).json({
                        status: 'error',
                        message: 'Registration deadline has passed',
                    });
                    return;
                }
            }

            // Check capacity
            if (event.maxAttendees) {
                const currentRegistrations = await prisma.eventRegistration.count({
                    where: {
                        eventId,
                        status: { in: ['CONFIRMED', 'PENDING'] },
                    },
                });

                if (currentRegistrations + guests + 1 > event.maxAttendees) {
                    res.status(400).json({
                        status: 'error',
                        message: 'Event is at full capacity',
                    });
                    return;
                }
            }

            // Check if already registered
            const existingRegistration = await prisma.eventRegistration.findUnique({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
            });

            if (existingRegistration) {
                res.status(400).json({
                    status: 'error',
                    message: 'Already registered for this event',
                });
                return;
            }

            // Create registration
            const registration = await prisma.eventRegistration.create({
                data: {
                    eventId,
                    userId,
                    guests,
                    notes,
                    status: event.isRegistrationRequired ? 'PENDING' : 'CONFIRMED',
                },
                include: {
                    event: {
                        select: {
                            title: true,
                            startDate: true,
                            location: true,
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
            });

            // Send confirmation email
            if (registration.status === 'CONFIRMED') {
                await sendEmail({
                    to: registration.user.email,
                    subject: `Registration Confirmed: ${registration.event.title}`,
                    template: 'event-registration',
                    data: {
                        name: `${registration.user.firstName} ${registration.user.lastName}`,
                        eventTitle: registration.event.title,
                        eventDate: new Date(registration.event.startDate).toLocaleDateString(),
                        eventTime: new Date(registration.event.startDate).toLocaleTimeString(),
                        eventLocation: registration.event.location,
                        registrationId: registration.id,
                    },
                });
            }

            res.status(201).json({
                status: 'success',
                message: 'Registered for event successfully',
                data: {
                    registration,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateRegistration(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { eventId } = req.params;
            const { guests, notes } = req.body;

            const registration = await prisma.eventRegistration.update({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
                data: {
                    guests,
                    notes,
                },
                include: {
                    event: true,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Registration updated successfully',
                data: {
                    registration,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async cancelRegistration(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { eventId } = req.params;

            await prisma.eventRegistration.delete({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Registration cancelled successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserRegistration(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { eventId } = req.params;

            const registration = await prisma.eventRegistration.findUnique({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
                include: {
                    event: true,
                },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    registration,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUserRegisteredEvents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { status } = req.query;

            const registrations = await prisma.eventRegistration.findMany({
                where: {
                    userId,
                    ...(status && { status: status as string }),
                },
                include: {
                    event: true,
                },
                orderBy: {
                    event: {
                        startDate: 'asc',
                    },
                },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    registrations,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async createEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const eventData = req.body;
            const userId = req.user.id;

            const event = await prisma.event.create({
                data: {
                    ...eventData,
                    startDate: new Date(eventData.startDate),
                    endDate: eventData.endDate ? new Date(eventData.endDate) : undefined,
                    registrationDeadline: eventData.registrationDeadline ? new Date(eventData.registrationDeadline) : undefined,
                },
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'CREATE_EVENT',
                    details: `Created event: ${event.title}`,
                    metadata: { eventId: event.id },
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Event created successfully',
                data: {
                    event,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;
            const eventData = req.body;
            const userId = req.user.id;

            // Convert date strings to Date objects
            if (eventData.startDate) eventData.startDate = new Date(eventData.startDate);
            if (eventData.endDate) eventData.endDate = new Date(eventData.endDate);
            if (eventData.registrationDeadline) eventData.registrationDeadline = new Date(eventData.registrationDeadline);

            const event = await prisma.event.update({
                where: { id: eventId },
                data: eventData,
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'UPDATE_EVENT',
                    details: `Updated event: ${event.title}`,
                    metadata: { eventId: event.id },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Event updated successfully',
                data: {
                    event,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;
            const userId = req.user.id;

            const event = await prisma.event.findUnique({
                where: { id: eventId },
            });

            if (!event) {
                res.status(404).json({
                    status: 'error',
                    message: 'Event not found',
                });
                return;
            }

            await prisma.event.delete({
                where: { id: eventId },
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'DELETE_EVENT',
                    details: `Deleted event: ${event.title}`,
                    metadata: { eventId },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Event deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async uploadEventImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;
            const userId = req.user.id;

            if (!req.file) {
                res.status(400).json({
                    status: 'error',
                    message: 'No file uploaded',
                });
                return;
            }

            // Upload to S3
            const uploadResult = await UploadService.uploadFile(req.file, 'events', {
                eventId,
                uploadedBy: userId,
            });

            // Update event with image URL
            const event = await prisma.event.update({
                where: { id: eventId },
                data: { image: uploadResult.url },
            });

            res.status(200).json({
                status: 'success',
                message: 'Event image uploaded successfully',
                data: {
                    event: {
                        id: event.id,
                        title: event.title,
                        image: event.image,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getEventRegistrations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;
            const {
                page = 1,
                limit = 20,
                status,
                search,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = { eventId };
            if (status) filter.status = status;

            if (search) {
                filter.user = {
                    OR: [
                        { firstName: { contains: search as string, mode: 'insensitive' } },
                        { lastName: { contains: search as string, mode: 'insensitive' } },
                        { email: { contains: search as string, mode: 'insensitive' } },
                    ],
                };
            }

            // Get total count
            const total = await prisma.eventRegistration.count({
                where: filter,
            });

            // Get registrations
            const registrations = await prisma.eventRegistration.findMany({
                where: filter,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true,
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
                    registrations,
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

    static async updateRegistrationStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId, registrationId } = req.params;
            const { status, checkedIn } = req.body;

            const registration = await prisma.eventRegistration.update({
                where: { id: registrationId },
                data: {
                    status,
                    ...(checkedIn !== undefined && {
                        checkedIn,
                        checkedInAt: checkedIn ? new Date() : null,
                    }),
                },
                include: {
                    user: true,
                    event: true,
                },
            });

            // Send email notification if status changed to CONFIRMED
            if (status === 'CONFIRMED' && registration.status === 'PENDING') {
                await sendEmail({
                    to: registration.user.email,
                    subject: `Registration Confirmed: ${registration.event.title}`,
                    template: 'event-registration',
                    data: {
                        name: `${registration.user.firstName} ${registration.user.lastName}`,
                        eventTitle: registration.event.title,
                        eventDate: new Date(registration.event.startDate).toLocaleDateString(),
                        eventTime: new Date(registration.event.startDate).toLocaleTimeString(),
                        eventLocation: registration.event.location,
                        registrationId: registration.id,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Registration status updated successfully',
                data: {
                    registration,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async checkInAttendee(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;
            const { userId, guests = 0 } = req.body;

            // Find or create registration
            let registration = await prisma.eventRegistration.findUnique({
                where: {
                    eventId_userId: {
                        eventId,
                        userId,
                    },
                },
            });

            if (!registration) {
                registration = await prisma.eventRegistration.create({
                    data: {
                        eventId,
                        userId,
                        guests,
                        status: 'CONFIRMED',
                        checkedIn: true,
                        checkedInAt: new Date(),
                    },
                });
            } else {
                registration = await prisma.eventRegistration.update({
                    where: { id: registration.id },
                    data: {
                        checkedIn: true,
                        checkedInAt: new Date(),
                        guests,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Attendee checked in successfully',
                data: {
                    registration,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getEventStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;

            const [
                totalRegistrations,
                confirmedRegistrations,
                checkedInAttendees,
                waitlistCount,
                totalAttendees,
            ] = await Promise.all([
                prisma.eventRegistration.count({ where: { eventId } }),
                prisma.eventRegistration.count({
                    where: {
                        eventId,
                        status: 'CONFIRMED',
                    },
                }),
                prisma.eventRegistration.count({
                    where: {
                        eventId,
                        checkedIn: true,
                    },
                }),
                prisma.eventRegistration.count({
                    where: {
                        eventId,
                        status: 'WAITLIST',
                    },
                }),
                prisma.eventRegistration.aggregate({
                    where: {
                        eventId,
                        status: 'CONFIRMED',
                    },
                    _sum: { guests: true },
                }),
            ]);

            const stats = {
                totalRegistrations,
                confirmedRegistrations,
                checkedInAttendees,
                waitlistCount,
                totalAttendees: confirmedRegistrations + (totalAttendees._sum.guests || 0),
                attendanceRate: confirmedRegistrations > 0
                    ? Math.round((checkedInAttendees / confirmedRegistrations) * 100)
                    : 0,
            };

            res.status(200).json({
                status: 'success',
                data: { stats },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getEventAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, category } = req.query;

            const filter: any = {};
            if (startDate) filter.startDate = { gte: new Date(startDate as string) };
            if (endDate) filter.startDate = { ...filter.startDate, lte: new Date(endDate as string) };
            if (category) filter.category = category;

            const [
                totalEvents,
                totalRegistrations,
                averageAttendance,
                eventsByCategory,
                eventsByMonth,
            ] = await Promise.all([
                prisma.event.count({ where: filter }),
                prisma.eventRegistration.count({
                    where: {
                        event: filter,
                        status: 'CONFIRMED',
                    },
                }),
                prisma.eventRegistration.groupBy({
                    by: ['eventId'],
                    where: {
                        event: filter,
                        status: 'CONFIRMED',
                    },
                    _count: true,
                }).then(results => {
                    const counts = results.map(r => r._count);
                    return counts.length > 0
                        ? Math.round(counts.reduce((a, b) => a + b) / counts.length)
                        : 0;
                }),
                prisma.event.groupBy({
                    by: ['category'],
                    where: filter,
                    _count: true,
                }),
                prisma.event.groupBy({
                    by: ['startDate'],
                    where: filter,
                    _count: true,
                    _sum: {
                        maxAttendees: true,
                    },
                }),
            ]);

            const analytics = {
                totalEvents,
                totalRegistrations,
                averageAttendance,
                eventsByCategory: eventsByCategory.reduce((acc, item) => {
                    acc[item.category] = item._count;
                    return acc;
                }, {} as Record<string, number>),
                eventsByMonth: eventsByMonth.reduce((acc, item) => {
                    const month = new Date(item.startDate).toLocaleString('default', { month: 'short' });
                    acc[month] = (acc[month] || 0) + item._count;
                    return acc;
                }, {} as Record<string, number>),
            };

            res.status(200).json({
                status: 'success',
                data: { analytics },
            });
        } catch (error) {
            next(error);
        }
    }
}