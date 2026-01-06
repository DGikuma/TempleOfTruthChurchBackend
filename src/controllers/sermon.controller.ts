import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { UploadService } from '../services/upload.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class SermonController {
    // Public methods
    static async getSermons(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                preacher,
                series,
                tags,
                startDate,
                endDate,
                search,
                sortBy = 'date',
                sortOrder = 'desc',
                includeTranscript = false,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {};

            if (preacher) filter.preacher = { contains: preacher as string, mode: 'insensitive' };
            if (series) filter.series = { contains: series as string, mode: 'insensitive' };
            if (tags) {
                const tagArray = (tags as string).split(',');
                filter.tags = { hasSome: tagArray };
            }
            if (search) {
                filter.OR = [
                    { title: { contains: search as string, mode: 'insensitive' } },
                    { description: { contains: search as string, mode: 'insensitive' } },
                    { biblePassage: { contains: search as string, mode: 'insensitive' } },
                ];
            }

            if (startDate || endDate) {
                filter.date = {};
                if (startDate) filter.date.gte = new Date(startDate as string);
                if (endDate) filter.date.lte = new Date(endDate as string);
            }

            // Select fields
            const select: any = {
                id: true,
                title: true,
                description: true,
                preacher: true,
                preacherId: true,
                date: true,
                duration: true,
                series: true,
                biblePassage: true,
                videoUrl: true,
                audioUrl: true,
                thumbnail: true,
                views: true,
                likes: true,
                downloads: true,
                tags: true,
                isLive: true,
                liveStreamId: true,
                createdAt: true,
            };

            if (includeTranscript === 'true') {
                select.transcript = true;
            }

            // Get total count
            const total = await prisma.sermon.count({ where: filter });

            // Get sermons
            const sermons = await prisma.sermon.findMany({
                where: filter,
                select,
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    sermons,
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

    static async getFeaturedSermons(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const sermons = await prisma.sermon.findMany({
                where: {
                    isLive: false,
                },
                orderBy: [
                    { views: 'desc' },
                    { date: 'desc' },
                ],
                take: 6,
                select: {
                    id: true,
                    title: true,
                    preacher: true,
                    date: true,
                    thumbnail: true,
                    views: true,
                    likes: true,
                },
            });

            res.status(200).json({
                status: 'success',
                data: { sermons },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSermonSeries(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const series = await prisma.sermon.findMany({
                where: {
                    series: { not: null },
                },
                select: {
                    series: true,
                },
                distinct: ['series'],
            });

            const seriesList = series
                .filter(s => s.series)
                .map(s => s.series)
                .sort();

            res.status(200).json({
                status: 'success',
                data: { series: seriesList },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSermonById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;

            const sermon = await prisma.sermon.findUnique({
                where: { id: sermonId },
            });

            if (!sermon) {
                res.status(404).json({
                    status: 'error',
                    message: 'Sermon not found',
                });
                return;
            }

            // Increment views
            await prisma.sermon.update({
                where: { id: sermonId },
                data: { views: { increment: 1 } },
            });

            res.status(200).json({
                status: 'success',
                data: { sermon },
            });
        } catch (error) {
            next(error);
        }
    }

    static async incrementViews(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;

            await prisma.sermon.update({
                where: { id: sermonId },
                data: { views: { increment: 1 } },
            });

            res.status(200).json({
                status: 'success',
                message: 'View count updated',
            });
        } catch (error) {
            next(error);
        }
    }

    static async toggleLike(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const userId = req.user.id;

            // Check if already liked
            const existingLike = await prisma.sermonLike.findUnique({
                where: {
                    sermonId_userId: {
                        sermonId,
                        userId,
                    },
                },
            });

            if (existingLike) {
                // Remove like
                await prisma.sermonLike.delete({
                    where: {
                        sermonId_userId: {
                            sermonId,
                            userId,
                        },
                    },
                });

                // Decrement likes count
                await prisma.sermon.update({
                    where: { id: sermonId },
                    data: { likes: { decrement: 1 } },
                });

                res.status(200).json({
                    status: 'success',
                    message: 'Like removed',
                    liked: false,
                });
            } else {
                // Add like
                await prisma.sermonLike.create({
                    data: {
                        sermonId,
                        userId,
                    },
                });

                // Increment likes count
                await prisma.sermon.update({
                    where: { id: sermonId },
                    data: { likes: { increment: 1 } },
                });

                res.status(200).json({
                    status: 'success',
                    message: 'Sermon liked',
                    liked: true,
                });
            }
        } catch (error) {
            next(error);
        }
    }

    static async downloadSermon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId, type } = req.params;
            const userId = req.user.id;

            const sermon = await prisma.sermon.findUnique({
                where: { id: sermonId },
            });

            if (!sermon) {
                res.status(404).json({
                    status: 'error',
                    message: 'Sermon not found',
                });
                return;
            }

            let downloadUrl: string | null = null;

            switch (type) {
                case 'audio':
                    downloadUrl = sermon.audioUrl;
                    break;
                case 'video':
                    downloadUrl = sermon.videoUrl;
                    break;
                case 'transcript':
                    downloadUrl = sermon.transcript;
                    break;
            }

            if (!downloadUrl) {
                res.status(404).json({
                    status: 'error',
                    message: `${type} not available for this sermon`,
                });
                return;
            }

            // Log download
            await prisma.sermonDownload.create({
                data: {
                    sermonId,
                    userId,
                    type: type.toUpperCase(),
                },
            });

            // Increment download count
            await prisma.sermon.update({
                where: { id: sermonId },
                data: { downloads: { increment: 1 } },
            });

            // Generate presigned URL if using S3
            if (downloadUrl.includes('amazonaws.com')) {
                const urlParts = downloadUrl.split('/');
                const key = urlParts.slice(3).join('/');
                downloadUrl = await UploadService.generatePresignedUrl(key, 3600);
            }

            res.status(200).json({
                status: 'success',
                data: { downloadUrl },
            });
        } catch (error) {
            next(error);
        }
    }

    // User methods
    static async getLikedSermons(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { page = 1, limit = 20 } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const likes = await prisma.sermonLike.findMany({
                where: { userId },
                include: {
                    sermon: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            const total = await prisma.sermonLike.count({
                where: { userId },
            });

            res.status(200).json({
                status: 'success',
                data: {
                    sermons: likes.map(like => like.sermon),
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

    static async getListeningHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { page = 1, limit = 20 } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const history = await prisma.sermonView.findMany({
                where: { userId },
                include: {
                    sermon: true,
                },
                orderBy: { viewedAt: 'desc' },
                distinct: ['sermonId'],
                skip,
                take: Number(limit),
            });

            const total = await prisma.sermonView.count({
                where: { userId },
                distinct: ['sermonId'],
            });

            res.status(200).json({
                status: 'success',
                data: {
                    sermons: history.map(h => h.sermon),
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

    // Admin methods
    static async createSermon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const sermonData = req.body;
            const userId = req.user.id;

            const sermon = await prisma.sermon.create({
                data: {
                    ...sermonData,
                    date: new Date(sermonData.date),
                },
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'CREATE_SERMON',
                    details: `Created sermon: ${sermon.title}`,
                    metadata: { sermonId: sermon.id },
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Sermon created successfully',
                data: { sermon },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateSermon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const sermonData = req.body;
            const userId = req.user.id;

            // Convert date if provided
            if (sermonData.date) {
                sermonData.date = new Date(sermonData.date);
            }

            const sermon = await prisma.sermon.update({
                where: { id: sermonId },
                data: sermonData,
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'UPDATE_SERMON',
                    details: `Updated sermon: ${sermon.title}`,
                    metadata: { sermonId: sermon.id },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Sermon updated successfully',
                data: { sermon },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteSermon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const userId = req.user.id;

            const sermon = await prisma.sermon.findUnique({
                where: { id: sermonId },
            });

            if (!sermon) {
                res.status(404).json({
                    status: 'error',
                    message: 'Sermon not found',
                });
                return;
            }

            await prisma.sermon.delete({
                where: { id: sermonId },
            });

            // Log activity
            await prisma.activityLog.create({
                data: {
                    userId,
                    action: 'DELETE_SERMON',
                    details: `Deleted sermon: ${sermon.title}`,
                    metadata: { sermonId },
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Sermon deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async uploadSermonMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const userId = req.user.id;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            const updateData: any = {};

            // Handle each file type
            if (files.video?.[0]) {
                const video = await UploadService.uploadFile(files.video[0], 'sermons/videos', {
                    sermonId,
                    uploadedBy: userId,
                    type: 'video',
                });
                updateData.videoUrl = video.url;
            }

            if (files.audio?.[0]) {
                const audio = await UploadService.uploadFile(files.audio[0], 'sermons/audio', {
                    sermonId,
                    uploadedBy: userId,
                    type: 'audio',
                });
                updateData.audioUrl = audio.url;
            }

            if (files.thumbnail?.[0]) {
                const thumbnail = await UploadService.uploadFile(files.thumbnail[0], 'sermons/thumbnails', {
                    sermonId,
                    uploadedBy: userId,
                    type: 'thumbnail',
                });
                updateData.thumbnail = thumbnail.url;
            }

            if (files.transcript?.[0]) {
                const transcript = await UploadService.uploadFile(files.transcript[0], 'sermons/transcripts', {
                    sermonId,
                    uploadedBy: userId,
                    type: 'transcript',
                });
                updateData.transcript = transcript.url;
            }

            // Update sermon
            const sermon = await prisma.sermon.update({
                where: { id: sermonId },
                data: updateData,
            });

            res.status(200).json({
                status: 'success',
                message: 'Media uploaded successfully',
                data: { sermon },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateTranscript(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const { transcript } = req.body;

            const sermon = await prisma.sermon.update({
                where: { id: sermonId },
                data: { transcript },
            });

            res.status(200).json({
                status: 'success',
                message: 'Transcript updated successfully',
                data: { sermon },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSermonAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, preacher } = req.query;

            const filter: any = {};
            if (startDate) filter.date = { gte: new Date(startDate as string) };
            if (endDate) filter.date = { ...filter.date, lte: new Date(endDate as string) };
            if (preacher) filter.preacher = { contains: preacher as string, mode: 'insensitive' };

            const [
                totalSermons,
                totalViews,
                totalLikes,
                totalDownloads,
                topSermons,
                sermonsByMonth,
            ] = await Promise.all([
                prisma.sermon.count({ where: filter }),
                prisma.sermon.aggregate({
                    where: filter,
                    _sum: { views: true },
                }),
                prisma.sermon.aggregate({
                    where: filter,
                    _sum: { likes: true },
                }),
                prisma.sermon.aggregate({
                    where: filter,
                    _sum: { downloads: true },
                }),
                prisma.sermon.findMany({
                    where: filter,
                    orderBy: { views: 'desc' },
                    take: 5,
                    select: {
                        id: true,
                        title: true,
                        preacher: true,
                        views: true,
                        likes: true,
                        date: true,
                    },
                }),
                prisma.sermon.groupBy({
                    by: ['date'],
                    where: filter,
                    _count: true,
                }),
            ]);

            const analytics = {
                totalSermons,
                totalViews: totalViews._sum.views || 0,
                totalLikes: totalLikes._sum.likes || 0,
                totalDownloads: totalDownloads._sum.downloads || 0,
                averageViews: totalSermons > 0 ? Math.round((totalViews._sum.views || 0) / totalSermons) : 0,
                topSermons,
                sermonsByMonth: sermonsByMonth.reduce((acc, item) => {
                    const month = new Date(item.date).toLocaleString('default', { month: 'short' });
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

    static async getTopSermons(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit = 10, period = 'month' } = req.query;

            const dateFilter: any = {};
            const now = new Date();

            switch (period) {
                case 'day':
                    dateFilter.gte = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'week':
                    dateFilter.gte = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'month':
                    dateFilter.gte = new Date(now.setMonth(now.getMonth() - 1));
                    break;
                case 'year':
                    dateFilter.gte = new Date(now.setFullYear(now.getFullYear() - 1));
                    break;
                // 'all' - no date filter
            }

            const filter: any = {};
            if (period !== 'all') {
                filter.date = dateFilter;
            }

            const topSermons = await prisma.sermon.findMany({
                where: filter,
                orderBy: { views: 'desc' },
                take: Number(limit),
                select: {
                    id: true,
                    title: true,
                    preacher: true,
                    date: true,
                    views: true,
                    likes: true,
                    thumbnail: true,
                },
            });

            res.status(200).json({
                status: 'success',
                data: { sermons: topSermons },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getAllSeries(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const seriesWithCounts = await prisma.sermon.groupBy({
                by: ['series'],
                where: {
                    series: { not: null },
                },
                _count: true,
                _avg: {
                    views: true,
                    likes: true,
                },
            });

            const series = seriesWithCounts
                .filter(s => s.series)
                .map(s => ({
                    name: s.series!,
                    count: s._count,
                    avgViews: Math.round(s._avg.views || 0),
                    avgLikes: Math.round(s._avg.likes || 0),
                }))
                .sort((a, b) => b.count - a.count);

            res.status(200).json({
                status: 'success',
                data: { series },
            });
        } catch (error) {
            next(error);
        }
    }

    static async createSeries(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const seriesData = req.body;

            // For now, series is just a string field in sermons
            // In a more complex implementation, you might have a separate Series model
            res.status(200).json({
                status: 'success',
                message: 'Series updated (sermons will use this series name)',
                data: { series: seriesData.name },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateSeries(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { seriesId } = req.params;
            const { name } = req.body;

            // Update all sermons with old series name to new series name
            // This assumes seriesId is actually the series name
            // In a real implementation with a Series model, this would be different
            await prisma.sermon.updateMany({
                where: { series: seriesId },
                data: { series: name },
            });

            res.status(200).json({
                status: 'success',
                message: 'Series updated successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteSeries(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { seriesId } = req.params;

            // Remove series from all sermons
            await prisma.sermon.updateMany({
                where: { series: seriesId },
                data: { series: null },
            });

            res.status(200).json({
                status: 'success',
                message: 'Series deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }
}