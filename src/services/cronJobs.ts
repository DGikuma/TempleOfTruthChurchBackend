// src/services/cronJobs.ts
import cron from 'node-cron';
import prisma from '../config/database';
import logger from '../utils/logger';
import { EmailService } from './email.service';
import { StreamingService } from './streaming.service';

export function startCronJobs(): void {
    // Daily tasks at 3 AM
    cron.schedule('0 3 * * *', async () => {
        logger.info('Running daily maintenance tasks...');

        try {
            // Clean up expired sessions
            await cleanupExpiredSessions();

            // Send daily prayer reminders
            await sendDailyPrayerReminders();

            // Update member statistics
            await updateMemberStatistics();

            logger.info('Daily maintenance tasks completed');
        } catch (error) {
            logger.error('Error in daily maintenance tasks:', error);
        }
    });

    // Hourly tasks
    cron.schedule('0 * * * *', async () => {
        logger.info('Running hourly tasks...');

        try {
            // Check for upcoming events and send reminders
            await sendEventReminders();

            // Update live stream statuses
            await updateLiveStreamStatuses();

            // Process queued emails
            await processEmailQueue();

            logger.info('Hourly tasks completed');
        } catch (error) {
            logger.error('Error in hourly tasks:', error);
        }
    });

    // Every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        try {
            // Check for stream starting soon
            await checkUpcomingStreams();

            // Update analytics cache
            await updateAnalyticsCache();

            // Backup database (in development)
            if (process.env.NODE_ENV === 'development') {
                await backupDatabase();
            }
        } catch (error) {
            logger.error('Error in 5-minute tasks:', error);
        }
    });

    // Weekly report every Monday at 9 AM
    cron.schedule('0 9 * * 1', async () => {
        try {
            await generateWeeklyReport();
            logger.info('Weekly report generated');
        } catch (error) {
            logger.error('Error generating weekly report:', error);
        }
    });

    // Monthly tasks on the 1st at 4 AM
    cron.schedule('0 4 1 * *', async () => {
        try {
            await generateMonthlyReport();
            await processMonthlyDonations();
            await archiveOldData();
            logger.info('Monthly tasks completed');
        } catch (error) {
            logger.error('Error in monthly tasks:', error);
        }
    });
}

async function cleanupExpiredSessions(): Promise<void> {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await prisma.session.deleteMany({
        where: {
            expires: {
                lt: oneWeekAgo,
            },
        },
    });

    logger.info('Expired sessions cleaned up');
}

async function sendDailyPrayerReminders(): Promise<void> {
    const prayerTeam = await prisma.user.findMany({
        where: {
            role: {
                in: ['MEMBER', 'LEADER', 'PASTOR', 'ADMIN'],
            },
            emailVerified: true,
        },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
        },
    });

    const recentPrayerRequests = await prisma.prayerRequest.findMany({
        where: {
            createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
            status: 'PENDING',
        },
        include: {
            user: {
                select: {
                    firstName: true,
                    lastName: true,
                },
            },
        },
        take: 10,
    });

    if (recentPrayerRequests.length > 0) {
        for (const member of prayerTeam) {
            await EmailService.sendEmail({
                to: member.email,
                subject: 'Daily Prayer Reminder - GracePoint Church',
                template: 'daily-prayer',
                data: {
                    name: `${member.firstName} ${member.lastName}`,
                    prayerRequests: recentPrayerRequests,
                    date: new Date().toLocaleDateString(),
                },
            });
        }

        logger.info(`Sent prayer reminders to ${prayerTeam.length} members`);
    }
}

async function updateMemberStatistics(): Promise<void> {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Calculate new members this month
    const newMembersThisMonth = await prisma.user.count({
        where: {
            membershipDate: {
                gte: firstDayOfMonth,
            },
            status: 'ACTIVE',
        },
    });

    // Calculate active members (logged in within last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeMembers = await prisma.user.count({
        where: {
            lastLogin: {
                gte: thirtyDaysAgo,
            },
            status: 'ACTIVE',
        },
    });

    // Store statistics in Redis cache
    // This would be implementation-specific based on your cache setup
    logger.info(`Updated member statistics: ${newMembersThisMonth} new members, ${activeMembers} active members`);
}

async function sendEventReminders(): Promise<void> {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find events starting soon
    const eventsStartingSoon = await prisma.event.findMany({
        where: {
            startDate: {
                gte: now,
                lte: twentyFourHoursFromNow,
            },
            status: 'UPCOMING',
        },
    });

    for (const event of eventsStartingSoon) {
        // Check if we should send reminders
        const hoursUntilEvent = (event.startDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        let shouldSendReminder = false;
        let reminderType = '';

        if (hoursUntilEvent <= 1 && hoursUntilEvent > 0) {
            shouldSendReminder = true;
            reminderType = '1-hour';
        } else if (hoursUntilEvent <= 24 && hoursUntilEvent > 23) {
            shouldSendReminder = true;
            reminderType = '24-hour';
        }

        if (shouldSendReminder) {
            // Get registered users
            const registrations = await prisma.eventRegistration.findMany({
                where: {
                    eventId: event.id,
                    status: 'CONFIRMED',
                },
                include: {
                    user: true,
                },
            });

            for (const registration of registrations) {
                await EmailService.sendEventRegistrationConfirmation(
                    registration.user,
                    event,
                    registration
                );
            }

            logger.info(`Sent ${reminderType} reminder for event ${event.title} to ${registrations.length} people`);
        }
    }
}

async function updateLiveStreamStatuses(): Promise<void> {
    try {
        const liveStreams = await prisma.sermon.findMany({
            where: {
                isLive: true,
            },
        });

        for (const stream of liveStreams) {
            if (stream.liveStreamId) {
                const streamInfo = await StreamingService.getStreamInfo(stream.liveStreamId);

                if (streamInfo.status === 'complete') {
                    // Stream has ended, update database
                    await prisma.sermon.update({
                        where: { id: stream.id },
                        data: {
                            isLive: false,
                            updatedAt: new Date(),
                        },
                    });

                    logger.info(`Updated stream ${stream.liveStreamId} status to ended`);
                }
            }
        }
    } catch (error) {
        logger.error('Error updating live stream statuses:', error);
    }
}

async function processEmailQueue(): Promise<void> {
    // Implementation depends on your email queue system
    // This could process emails from Redis queue or database queue
    logger.info('Processing email queue...');
}

async function checkUpcomingStreams(): Promise<void> {
    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

    const upcomingStreams = await prisma.sermon.findMany({
        where: {
            date: {
                gte: now,
                lte: thirtyMinutesFromNow,
            },
            isLive: false,
        },
    });

    for (const stream of upcomingStreams) {
        // Check if we should start the stream
        const minutesUntilStream = (stream.date.getTime() - now.getTime()) / (1000 * 60);

        if (minutesUntilStream <= 15 && minutesUntilStream > 0) {
            // Start stream preparation
            logger.info(`Preparing to start stream: ${stream.title}`);

            // Send notifications
            // Update status
            // etc.
        }
    }
}

async function updateAnalyticsCache(): Promise<void> {
    // Update cached analytics data
    // This could include:
    // - Current viewer counts
    // - Recent donations
    // - Member activity
    // - Event registrations
    logger.info('Updating analytics cache...');
}

async function backupDatabase(): Promise<void> {
    // Create database backup (development only)
    // In production, use managed database backup services
    logger.info('Creating database backup...');
}

async function generateWeeklyReport(): Promise<void> {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Gather statistics
    const [
        newMembers,
        totalDonations,
        eventAttendees,
        sermonViews,
    ] = await Promise.all([
        prisma.user.count({
            where: {
                createdAt: { gte: oneWeekAgo },
                status: 'ACTIVE',
            },
        }),
        prisma.donation.aggregate({
            where: {
                createdAt: { gte: oneWeekAgo },
                status: 'COMPLETED',
            },
            _sum: { amount: true },
        }),
        prisma.eventRegistration.count({
            where: {
                createdAt: { gte: oneWeekAgo },
                status: 'CONFIRMED',
            },
        }),
        prisma.sermon.aggregate({
            where: {
                createdAt: { gte: oneWeekAgo },
            },
            _sum: { views: true },
        }),
    ]);

    const reportData = {
        period: 'Weekly',
        startDate: oneWeekAgo,
        endDate: new Date(),
        newMembers,
        totalDonations: totalDonations._sum.amount || 0,
        eventAttendees,
        sermonViews: sermonViews._sum.views || 0,
    };

    // Send to administrators
    const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'PASTOR'] } },
        select: { email: true, firstName: true },
    });

    for (const admin of admins) {
        await EmailService.sendEmail({
            to: admin.email,
            subject: 'Weekly Church Report',
            template: 'weekly-report',
            data: {
                name: admin.firstName,
                report: reportData,
            },
        });
    }

    logger.info('Weekly report generated and sent');
}

async function generateMonthlyReport(): Promise<void> {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Similar to weekly but more comprehensive
    logger.info('Generating monthly report...');
}

async function processMonthlyDonations(): Promise<void> {
    // Process recurring monthly donations
    // This would integrate with Stripe/PayPal APIs
    logger.info('Processing monthly donations...');
}

async function archiveOldData(): Promise<void> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Archive old data (implementation depends on requirements)
    logger.info('Archiving old data...');
}