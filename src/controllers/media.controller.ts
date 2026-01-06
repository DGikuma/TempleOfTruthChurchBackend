// src/controllers/media.controller.ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { UploadService } from '../services/upload.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class MediaController {
    // Public methods
    static async getPublicGallery(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                category,
                tags,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter - only show public media
            const filter: any = {
                isPublic: true,
            };

            if (category) filter.category = category;
            if (tags) {
                const tagArray = (tags as string).split(',');
                filter.tags = { hasSome: tagArray };
            }

            // Get total count
            const total = await prisma.media.count({ where: filter });

            // Get media
            const media = await prisma.media.findMany({
                where: filter,
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    media,
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

    static async getSermonThumbnails(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const thumbnails = await prisma.sermon.findMany({
                where: {
                    thumbnail: { not: null },
                },
                select: {
                    id: true,
                    title: true,
                    preacher: true,
                    date: true,
                    thumbnail: true,
                },
                orderBy: { date: 'desc' },
                take: 12,
            });

            res.status(200).json({
                status: 'success',
                data: { thumbnails },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getEventGallery(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { eventId } = req.params;

            const media = await prisma.media.findMany({
                where: {
                    category: 'EVENT',
                    metadata: {
                        path: ['eventId'],
                        equals: eventId,
                    },
                    isPublic: true,
                },
                orderBy: { createdAt: 'desc' },
            });

            res.status(200).json({
                status: 'success',
                data: { media },
            });
        } catch (error) {
            next(error);
        }
    }

    // Protected methods
    static async uploadMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const files = req.files as Express.Multer.File[];
            const { category = 'GALLERY', tags = [], isPublic = true } = req.body;

            if (!files || files.length === 0) {
                res.status(400).json({
                    status: 'error',
                    message: 'No files uploaded',
                });
                return;
            }

            const uploadResults = [];

            for (const file of files) {
                const uploadResult = await UploadService.uploadFile(file, `user-uploads/${category.toLowerCase()}`, {
                    userId,
                    category,
                    isPublic: isPublic === 'true',
                    tags: Array.isArray(tags) ? tags : tags.split(','),
                });

                // Create media record in database
                const media = await prisma.media.create({
                    data: {
                        filename: uploadResult.metadata.originalName,
                        originalName: uploadResult.metadata.originalName,
                        mimeType: file.mimetype,
                        size: uploadResult.metadata.size,
                        url: uploadResult.url,
                        category: category as any,
                        tags: Array.isArray(tags) ? tags : tags.split(','),
                        uploadedById: userId,
                        isPublic: isPublic === 'true',
                        metadata: uploadResult.metadata,
                    },
                });

                uploadResults.push(media);
            }

            res.status(201).json({
                status: 'success',
                message: `${files.length} file(s) uploaded successfully`,
                data: { media: uploadResults },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getMyUploads(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const {
                page = 1,
                limit = 20,
                category,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = { uploadedById: userId };
            if (category) filter.category = category;

            // Get total count
            const total = await prisma.media.count({ where: filter });

            // Get media
            const media = await prisma.media.findMany({
                where: filter,
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    media,
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

    static async deleteMyMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const { mediaId } = req.params;

            // Verify ownership
            const media = await prisma.media.findFirst({
                where: {
                    id: mediaId,
                    uploadedById: userId,
                },
            });

            if (!media) {
                res.status(404).json({
                    status: 'error',
                    message: 'Media not found or not authorized',
                });
                return;
            }

            // Delete from S3
            const urlParts = media.url.split('/');
            const key = urlParts.slice(3).join('/');
            await UploadService.deleteFile(key);

            // Delete from database
            await prisma.media.delete({
                where: { id: mediaId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Media deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async getAllMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                category,
                uploadedById,
                startDate,
                endDate,
                tags,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter: any = {};

            if (category) filter.category = category;
            if (uploadedById) filter.uploadedById = uploadedById;
            if (tags) {
                const tagArray = (tags as string).split(',');
                filter.tags = { hasSome: tagArray };
            }
            if (search) {
                filter.OR = [
                    { filename: { contains: search as string, mode: 'insensitive' } },
                    { originalName: { contains: search as string, mode: 'insensitive' } },
                ];
            }

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            // Get total count
            const total = await prisma.media.count({ where: filter });

            // Get media
            const media = await prisma.media.findMany({
                where: filter,
                include: {
                    uploadedBy: {
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
                    media,
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

    static async getMediaById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { mediaId } = req.params;

            const media = await prisma.media.findUnique({
                where: { id: mediaId },
                include: {
                    uploadedBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });

            if (!media) {
                res.status(404).json({
                    status: 'error',
                    message: 'Media not found',
                });
                return;
            }

            res.status(200).json({
                status: 'success',
                data: { media },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { mediaId } = req.params;
            const updateData = req.body;

            const media = await prisma.media.update({
                where: { id: mediaId },
                data: updateData,
            });

            res.status(200).json({
                status: 'success',
                message: 'Media updated successfully',
                data: { media },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { mediaId } = req.params;

            const media = await prisma.media.findUnique({
                where: { id: mediaId },
            });

            if (!media) {
                res.status(404).json({
                    status: 'error',
                    message: 'Media not found',
                });
                return;
            }

            // Delete from S3
            const urlParts = media.url.split('/');
            const key = urlParts.slice(3).join('/');
            await UploadService.deleteFile(key);

            // Delete from database
            await prisma.media.delete({
                where: { id: mediaId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Media deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async bulkDeleteMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { mediaIds } = req.body;

            // Get media items
            const mediaItems = await prisma.media.findMany({
                where: {
                    id: { in: mediaIds },
                },
            });

            // Delete from S3
            for (const media of mediaItems) {
                const urlParts = media.url.split('/');
                const key = urlParts.slice(3).join('/');
                try {
                    await UploadService.deleteFile(key);
                } catch (error) {
                    logger.error(`Failed to delete file from S3: ${key}`, error);
                }
            }

            // Delete from database
            await prisma.media.deleteMany({
                where: {
                    id: { in: mediaIds },
                },
            });

            res.status(200).json({
                status: 'success',
                message: `${mediaIds.length} media items deleted successfully`,
            });
        } catch (error) {
            next(error);
        }
    }

    static async bulkUpdateMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { mediaIds, updates } = req.body;

            await prisma.media.updateMany({
                where: {
                    id: { in: mediaIds },
                },
                data: updates,
            });

            res.status(200).json({
                status: 'success',
                message: `${mediaIds.length} media items updated successfully`,
            });
        } catch (error) {
            next(error);
        }
    }

    static async uploadSermonThumbnail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sermonId } = req.params;
            const userId = req.user.id;

            if (!req.file) {
                res.status(400).json({
                    status: 'error',
                    message: 'No file uploaded',
                });
                return;
            }

            // Upload to S3
            const uploadResult = await UploadService.uploadFile(req.file, 'sermons/thumbnails', {
                sermonId,
                uploadedBy: userId,
                type: 'thumbnail',
            });

            // Update sermon
            const sermon = await prisma.sermon.update({
                where: { id: sermonId },
                data: { thumbnail: uploadResult.url },
            });

            // Also create media record
            await prisma.media.create({
                data: {
                    filename: uploadResult.metadata.originalName,
                    originalName: uploadResult.metadata.originalName,
                    mimeType: req.file.mimetype,
                    size: uploadResult.metadata.size,
                    url: uploadResult.url,
                    category: 'SERMON',
                    tags: ['thumbnail'],
                    uploadedById: userId,
                    isPublic: true,
                    metadata: uploadResult.metadata,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Sermon thumbnail uploaded successfully',
                data: {
                    sermon: {
                        id: sermon.id,
                        title: sermon.title,
                        thumbnail: sermon.thumbnail,
                    },
                },
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
            const uploadResult = await UploadService.uploadFile(req.file, 'events/images', {
                eventId,
                uploadedBy: userId,
                type: 'event-image',
            });

            // Update event
            const event = await prisma.event.update({
                where: { id: eventId },
                data: { image: uploadResult.url },
            });

            // Also create media record
            await prisma.media.create({
                data: {
                    filename: uploadResult.metadata.originalName,
                    originalName: uploadResult.metadata.originalName,
                    mimeType: req.file.mimetype,
                    size: uploadResult.metadata.size,
                    url: uploadResult.url,
                    category: 'EVENT',
                    tags: ['event-image'],
                    uploadedById: userId,
                    isPublic: true,
                    metadata: uploadResult.metadata,
                },
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

    static async uploadGalleryImages(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const files = req.files as Express.Multer.File[];
            const { tags = [], isPublic = true } = req.body;

            if (!files || files.length === 0) {
                res.status(400).json({
                    status: 'error',
                    message: 'No files uploaded',
                });
                return;
            }

            const uploadResults = [];

            for (const file of files) {
                const uploadResult = await UploadService.uploadFile(file, 'gallery', {
                    userId,
                    category: 'GALLERY',
                    isPublic: isPublic === 'true',
                    tags: Array.isArray(tags) ? tags : tags.split(','),
                });

                // Create media record
                const media = await prisma.media.create({
                    data: {
                        filename: uploadResult.metadata.originalName,
                        originalName: uploadResult.metadata.originalName,
                        mimeType: file.mimetype,
                        size: uploadResult.metadata.size,
                        url: uploadResult.url,
                        category: 'GALLERY',
                        tags: Array.isArray(tags) ? tags : tags.split(','),
                        uploadedById: userId,
                        isPublic: isPublic === 'true',
                        metadata: uploadResult.metadata,
                    },
                });

                uploadResults.push(media);
            }

            res.status(201).json({
                status: 'success',
                message: `${files.length} image(s) uploaded to gallery`,
                data: { media: uploadResults },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStorageAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const [
                totalMedia,
                totalSize,
                mediaByCategory,
                recentUploads,
                largestFiles,
            ] = await Promise.all([
                prisma.media.count(),
                prisma.media.aggregate({
                    _sum: { size: true },
                }),
                prisma.media.groupBy({
                    by: ['category'],
                    _count: true,
                    _sum: { size: true },
                }),
                prisma.media.findMany({
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        uploadedBy: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                }),
                prisma.media.findMany({
                    orderBy: { size: 'desc' },
                    take: 10,
                    include: {
                        uploadedBy: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                }),
            ]);

            const analytics = {
                totalMedia,
                totalSize: totalSize._sum.size || 0,
                totalSizeGB: ((totalSize._sum.size || 0) / (1024 * 1024 * 1024)).toFixed(2),
                mediaByCategory: mediaByCategory.reduce((acc, item) => {
                    acc[item.category] = {
                        count: item._count,
                        size: item._sum.size || 0,
                        sizeGB: ((item._sum.size || 0) / (1024 * 1024 * 1024)).toFixed(2),
                    };
                    return acc;
                }, {} as Record<string, any>),
                recentUploads,
                largestFiles,
            };

            res.status(200).json({
                status: 'success',
                data: { analytics },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getMediaUsageAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, groupBy = 'month' } = req.query;

            const filter: any = {};

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            const uploadsOverTime = await prisma.media.groupBy({
                by: ['createdAt'],
                where: filter,
                _count: true,
                _sum: { size: true },
            });

            // Process time-based data
            const timeData = uploadsOverTime.reduce((acc, item) => {
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
                    default:
                        key = date.toLocaleDateString();
                }

                if (!acc[key]) {
                    acc[key] = { count: 0, size: 0 };
                }
                acc[key].count += item._count;
                acc[key].size += item._sum.size || 0;

                return acc;
            }, {} as Record<string, { count: number; size: number }>);

            const analytics = {
                uploadsOverTime: Object.entries(timeData).map(([date, data]) => ({
                    date,
                    count: data.count,
                    size: data.size,
                    sizeMB: (data.size / (1024 * 1024)).toFixed(2),
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
}