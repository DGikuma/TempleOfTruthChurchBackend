import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { PaymentService } from '../services/payment.service';
import { sendEmail } from '../services/email.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class DonationController {
    // Public methods
    static async createPaymentIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const donationData = req.body;

            const result = await PaymentService.createStripePaymentIntent(donationData);

            if (!result.success) {
                res.status(400).json({
                    status: 'error',
                    message: result.error || 'Failed to create payment intent',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: {
                    clientSecret: result.clientSecret,
                    transactionId: result.transactionId,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async createPayPalOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const donationData = req.body;

            const result = await PaymentService.createPayPalOrder(donationData);

            if (!result.success) {
                res.status(400).json({
                    status: 'error',
                    message: result.error || 'Failed to create PayPal order',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: {
                    orderId: result.transactionId,
                    approvalUrl: result.approvalUrl,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    // Protected methods
    static async getMyDonations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const {
                page = 1,
                limit = 20,
                startDate,
                endDate,
                status,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = { userId };

            if (status) filter.status = status;

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            // Get total count
            const total = await prisma.donation.count({ where: filter });

            // Get donations
            const donations = await prisma.donation.findMany({
                where: filter,
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            // Calculate totals
            const totalAmount = await prisma.donation.aggregate({
                where: {
                    ...filter,
                    status: 'COMPLETED',
                },
                _sum: { amount: true },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    donations,
                    summary: {
                        totalAmount: totalAmount._sum.amount || 0,
                        totalDonations: total,
                    },
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

    static async getMyDonationById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { donationId } = req.params;

            const donation = await prisma.donation.findFirst({
                where: {
                    id: donationId,
                    userId,
                },
            });

            if (!donation) {
                res.status(404).json({
                    status: 'error',
                    message: 'Donation not found',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: { donation },
            });
        } catch (error) {
            next(error);
        }
    }

    static async downloadReceipt(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { donationId } = req.params;

            const donation = await prisma.donation.findFirst({
                where: {
                    id: donationId,
                    userId,
                    status: 'COMPLETED',
                },
            });

            if (!donation) {
                res.status(404).json({
                    status: 'error',
                    message: 'Receipt not found',
                });
                return;
            }

            // Generate PDF receipt
            // This would use a PDF generation library like pdfkit
            // For now, return donation details
            res.status(200).json({
                status: 'success',
                data: {
                    receipt: {
                        receiptNumber: donation.receiptNumber,
                        date: donation.createdAt,
                        donorName: donation.donorName,
                        amount: donation.amount,
                        currency: donation.currency,
                        designation: donation.designation,
                        paymentMethod: donation.paymentMethod,
                        transactionId: donation.transactionId,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async setupRecurringDonation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const donationData = req.body;

            const result = await PaymentService.createRecurringDonation(userId, donationData);

            if (!result.success) {
                res.status(400).json({
                    status: 'error',
                    message: result.error || 'Failed to setup recurring donation',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                message: 'Recurring donation setup successfully',
                data: {
                    clientSecret: result.clientSecret,
                    subscriptionId: result.transactionId,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async cancelRecurringDonation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { subscriptionId } = req.params;

            // In a real implementation, you would cancel the subscription with Stripe
            // For now, update the donation record
            await prisma.donation.updateMany({
                where: {
                    userId,
                    metadata: {
                        path: ['subscriptionId'],
                        equals: subscriptionId,
                    },
                },
                data: {
                    status: 'CANCELLED',
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Recurring donation cancelled successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getTaxSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { year } = req.params;

            const startDate = new Date(`${year}-01-01`);
            const endDate = new Date(`${year}-12-31`);

            const donations = await prisma.donation.findMany({
                where: {
                    userId,
                    status: 'COMPLETED',
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                orderBy: { createdAt: 'asc' },
            });

            const summary = {
                year: parseInt(year),
                totalAmount: donations.reduce((sum, donation) => sum + donation.amount, 0),
                donationCount: donations.length,
                donationsByMonth: Array.from({ length: 12 }, (_, i) => {
                    const monthDonations = donations.filter(d =>
                        d.createdAt.getMonth() === i
                    );
                    return {
                        month: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }),
                        amount: monthDonations.reduce((sum, d) => sum + d.amount, 0),
                        count: monthDonations.length,
                    };
                }),
                donationsByDesignation: donations.reduce((acc, donation) => {
                    const designation = donation.designation || 'General';
                    acc[designation] = (acc[designation] || 0) + donation.amount;
                    return acc;
                }, {} as Record<string, number>),
            };

            res.status(200).json({
                status: 'success',
                data: { summary },
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async getAllDonations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                startDate,
                endDate,
                userId,
                status,
                designation,
                frequency,
                paymentMethod,
                minAmount,
                maxAmount,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {};

            if (userId) filter.userId = userId;
            if (status) filter.status = status;
            if (designation) filter.designation = designation;
            if (frequency) filter.frequency = frequency;
            if (paymentMethod) filter.paymentMethod = paymentMethod;

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            if (minAmount || maxAmount) {
                filter.amount = {};
                if (minAmount) filter.amount.gte = parseFloat(minAmount as string);
                if (maxAmount) filter.amount.lte = parseFloat(maxAmount as string);
            }

            if (search) {
                filter.OR = [
                    { donorName: { contains: search as string, mode: 'insensitive' } },
                    { donorEmail: { contains: search as string, mode: 'insensitive' } },
                    { receiptNumber: { contains: search as string, mode: 'insensitive' } },
                    { transactionId: { contains: search as string, mode: 'insensitive' } },
                ];
            }

            // Get total count
            const total = await prisma.donation.count({ where: filter });

            // Get donations
            const donations = await prisma.donation.findMany({
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
                },
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    donations,
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

    static async getDonationById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { donationId } = req.params;

            const donation = await prisma.donation.findUnique({
                where: { id: donationId },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });

            if (!donation) {
                res.status(404).json({
                    status: 'error',
                    message: 'Donation not found',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: { donation },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateDonationStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { donationId } = req.params;
            const { status, notes } = req.body;

            const donation = await prisma.donation.update({
                where: { id: donationId },
                data: {
                    status,
                    ...(notes && { notes }),
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

            // Send notification email if status changed to COMPLETED
            if (status === 'COMPLETED' && donation.status !== 'COMPLETED') {
                await sendEmail({
                    to: donation.donorEmail,
                    subject: 'Donation Receipt - GracePoint Church',
                    template: 'donation-receipt',
                    data: {
                        name: donation.donorName,
                        amount: donation.amount,
                        currency: donation.currency,
                        transactionId: donation.transactionId,
                        receiptNumber: donation.receiptNumber,
                        designation: donation.designation,
                        date: donation.createdAt.toLocaleDateString(),
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Donation status updated successfully',
                data: { donation },
            });
        } catch (error) {
            next(error);
        }
    }

    static async createManualDonation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const donationData = req.body;

            // Generate receipt number
            const receiptNumber = `GPC-MAN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const donation = await prisma.donation.create({
                data: {
                    ...donationData,
                    receiptNumber,
                    status: 'COMPLETED',
                    date: new Date(donationData.date),
                },
            });

            // Send receipt email
            await sendEmail({
                to: donation.donorEmail,
                subject: 'Donation Receipt - GracePoint Church',
                template: 'donation-receipt',
                data: {
                    name: donation.donorName,
                    amount: donation.amount,
                    currency: donation.currency,
                    receiptNumber: donation.receiptNumber,
                    designation: donation.designation,
                    date: donation.createdAt.toLocaleDateString(),
                    paymentMethod: donation.paymentMethod,
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Manual donation recorded successfully',
                data: { donation },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteDonation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { donationId } = req.params;

            await prisma.donation.delete({
                where: { id: donationId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Donation deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async getDonationAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, groupBy = 'month' } = req.query;

            const filter: any = {
                status: 'COMPLETED',
            };

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            const [
                totalAmount,
                donationCount,
                averageDonation,
                donationsByDesignation,
                donationsByPaymentMethod,
                donationsOverTime,
            ] = await Promise.all([
                prisma.donation.aggregate({
                    where: filter,
                    _sum: { amount: true },
                }),
                prisma.donation.count({ where: filter }),
                prisma.donation.aggregate({
                    where: filter,
                    _avg: { amount: true },
                }),
                prisma.donation.groupBy({
                    by: ['designation'],
                    where: filter,
                    _sum: { amount: true },
                    _count: true,
                }),
                prisma.donation.groupBy({
                    by: ['paymentMethod'],
                    where: filter,
                    _sum: { amount: true },
                }),
                prisma.donation.groupBy({
                    by: ['createdAt'],
                    where: filter,
                    _sum: { amount: true },
                    _count: true,
                }),
            ]);

            // Process time-based data based on groupBy
            const timeData = donationsOverTime.reduce((acc, item) => {
                let key: string;
                const date = new Date(item.createdAt);

                switch (groupBy) {
                    case 'day':
                        key = date.toLocaleDateString();
                        break;
                    case 'week':
                        const weekStart = new Date(date);
                        weekStart.setDate(date.getDate() - date.getDay());
                        key = weekStart.toLocaleDateString();
                        break;
                    case 'month':
                        key = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                        break;
                    case 'year':
                        key = date.getFullYear().toString();
                        break;
                    default:
                        key = date.toLocaleDateString();
                }

                if (!acc[key]) {
                    acc[key] = { amount: 0, count: 0 };
                }
                acc[key].amount += item._sum.amount || 0;
                acc[key].count += item._count;

                return acc;
            }, {} as Record<string, { amount: number; count: number }>);

            const analytics = {
                totalAmount: totalAmount._sum.amount || 0,
                donationCount,
                averageDonation: Math.round(averageDonation._avg.amount || 0),
                donationsByDesignation: donationsByDesignation.reduce((acc, item) => {
                    acc[item.designation || 'General'] = {
                        amount: item._sum.amount || 0,
                        count: item._count,
                    };
                    return acc;
                }, {} as Record<string, { amount: number; count: number }>),
                donationsByPaymentMethod: donationsByPaymentMethod.reduce((acc, item) => {
                    acc[item.paymentMethod] = item._sum.amount || 0;
                    return acc;
                }, {} as Record<string, number>),
                donationsOverTime: Object.entries(timeData).map(([date, data]) => ({
                    date,
                    amount: data.amount,
                    count: data.count,
                })),
            };

            res.status(200).json({
                status: 'success',
                data: { analytics },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getTopDonors(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit = 10, year } = req.query;

            const filter: any = {
                status: 'COMPLETED',
            };

            if (year) {
                const startDate = new Date(`${year}-01-01`);
                const endDate = new Date(`${year}-12-31`);
                filter.createdAt = {
                    gte: startDate,
                    lte: endDate,
                };
            }

            // Group by donor (using userId if available, otherwise donorEmail)
            const donations = await prisma.donation.findMany({
                where: filter,
                select: {
                    userId: true,
                    donorName: true,
                    donorEmail: true,
                    amount: true,
                },
            });

            // Aggregate by donor
            const donorMap = new Map();

            donations.forEach(donation => {
                const key = donation.userId || donation.donorEmail;
                if (!donorMap.has(key)) {
                    donorMap.set(key, {
                        donorName: donation.donorName,
                        donorEmail: donation.donorEmail,
                        userId: donation.userId,
                        totalAmount: 0,
                        donationCount: 0,
                    });
                }

                const donor = donorMap.get(key);
                donor.totalAmount += donation.amount;
                donor.donationCount += 1;
            });

            // Convert to array and sort
            const topDonors = Array.from(donorMap.values())
                .sort((a, b) => b.totalAmount - a.totalAmount)
                .slice(0, Number(limit));

            res.status(200).json({
                status: 'success',
                data: { donors: topDonors },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getRecurringDonationStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const recurringDonations = await prisma.donation.findMany({
                where: {
                    status: 'COMPLETED',
                    frequency: { in: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] },
                },
                select: {
                    frequency: true,
                    amount: true,
                    createdAt: true,
                },
            });

            const stats = {
                totalRecurring: recurringDonations.length,
                monthlyRecurringRevenue: recurringDonations.reduce((sum, donation) => {
                    let monthlyAmount = donation.amount;
                    switch (donation.frequency) {
                        case 'WEEKLY':
                            monthlyAmount = donation.amount * 4.33; // Average weeks per month
                            break;
                        case 'QUARTERLY':
                            monthlyAmount = donation.amount / 3;
                            break;
                        case 'YEARLY':
                            monthlyAmount = donation.amount / 12;
                            break;
                    }
                    return sum + monthlyAmount;
                }, 0),
                byFrequency: recurringDonations.reduce((acc, donation) => {
                    acc[donation.frequency] = (acc[donation.frequency] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
            };

            res.status(200).json({
                status: 'success',
                data: { stats },
            });
        } catch (error) {
            next(error);
        }
    }

    static async exportDonations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, format = 'csv' } = req.query;

            const filter: any = {
                createdAt: {
                    gte: new Date(startDate as string),
                    lte: new Date(endDate as string),
                },
            };

            const donations = await prisma.donation.findMany({
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
                orderBy: { createdAt: 'asc' },
            });

            // Format data based on requested format
            let data: any;
            let contentType: string;
            let filename: string;

            const dateRange = `${(startDate as string).split('T')[0]}_to_${(endDate as string).split('T')[0]}`;

            switch (format) {
                case 'csv':
                    // Convert to CSV
                    const headers = ['Date', 'Donor Name', 'Donor Email', 'Amount', 'Currency', 'Designation', 'Payment Method', 'Status'];
                    const rows = donations.map(d => [
                        d.createdAt.toISOString(),
                        d.donorName,
                        d.donorEmail,
                        d.amount,
                        d.currency,
                        d.designation,
                        d.paymentMethod,
                        d.status,
                    ]);
                    data = [headers, ...rows].map(row => row.join(',')).join('\n');
                    contentType = 'text/csv';
                    filename = `donations_${dateRange}.csv`;
                    break;

                case 'excel':
                    // Using exceljs would go here
                    // For now, return CSV
                    const excelHeaders = ['Date', 'Donor Name', 'Donor Email', 'Amount', 'Currency', 'Designation', 'Payment Method', 'Status'];
                    const excelRows = donations.map(d => [
                        d.createdAt.toISOString(),
                        d.donorName,
                        d.donorEmail,
                        d.amount,
                        d.currency,
                        d.designation,
                        d.paymentMethod,
                        d.status,
                    ]);
                    data = [excelHeaders, ...excelRows].map(row => row.join(',')).join('\n');
                    contentType = 'application/vnd.ms-excel';
                    filename = `donations_${dateRange}.xlsx`;
                    break;

                case 'pdf':
                    // PDF generation would go here
                    // For now, return JSON
                    data = JSON.stringify({ donations }, null, 2);
                    contentType = 'application/pdf';
                    filename = `donations_${dateRange}.pdf`;
                    break;

                default:
                    data = JSON.stringify({ donations }, null, 2);
                    contentType = 'application/json';
                    filename = `donations_${dateRange}.json`;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(data);
        } catch (error) {
            next(error);
        }
    }
}