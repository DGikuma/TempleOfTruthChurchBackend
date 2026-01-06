import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { StreamingService } from '../services/streaming.service';
import { AuthRequest } from '../middleware/auth.middleware';

export class StreamingController {
    // Public methods
    static async getLiveStreams(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const liveStreams = await prisma.sermon.findMany({
                where: {
                    isLive: true,
                    date: {
                        lte: new Date(),
                    },
                },
                orderBy: { date: 'desc' },
                take: 5,
            });

            res.status(200).json({
                status: 'success',
                data: { streams: liveStreams },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getUpcomingStreams(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const upcomingStreams = await prisma.sermon.findMany({
                where: {
                    isLive: true,
                    date: {
                        gt: new Date(),
                    },
                },
                orderBy: { date: 'asc' },
                take: 10,
            });

            res.status(200).json({
                status: 'success',
                data: { streams: upcomingStreams },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStreamInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.findUnique({
                where: { id: streamId },
            });

            if (!stream) {
                res.status(404).json({
                    status: 'error',
                    message: 'Stream not found',
                });
                return;
            }

            // Get additional stream info from service
            let streamInfo = {};
            if (stream.liveStreamId) {
                try {
                    streamInfo = await StreamingService.getStreamInfo(stream.liveStreamId);
                } catch (error) {
                    logger.warn('Could not fetch stream info from service:', error);
                }
            }

            res.status(200).json({
                status: 'success',
                data: {
                    stream: {
                        ...stream,
                        ...streamInfo,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStreamConnectionInfo(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.findUnique({
                where: { id: streamId },
            });

            if (!stream) {
                res.status(404).json({
                    status: 'error',
                    message: 'Stream not found',
                });
                return;
            }

            // Generate connection info (WebSocket URL, etc.)
            const connectionInfo = {
                websocketUrl: `wss://${req.headers.host}/ws/stream/${streamId}`,
                streamId: stream.liveStreamId,
                viewerId: req.user?.id,
            };

            res.status(200).json({
                status: 'success',
                data: { connectionInfo },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getChatHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { limit = 100, before } = req.query;

            const chatHistory = await StreamingService.getChatHistory(streamId, Number(limit));

            res.status(200).json({
                status: 'success',
                data: { messages: chatHistory },
            });
        } catch (error) {
            next(error);
        }
    }

    // Protected methods
    static async joinStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const userId = req.user.id;

            await StreamingService.updateViewerCount(streamId, userId, 'join');

            res.status(200).json({
                status: 'success',
                message: 'Joined stream',
            });
        } catch (error) {
            next(error);
        }
    }

    static async leaveStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const userId = req.user.id;

            await StreamingService.updateViewerCount(streamId, userId, 'leave');

            res.status(200).json({
                status: 'success',
                message: 'Left stream',
            });
        } catch (error) {
            next(error);
        }
    }

    static async sendChatMessage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const userId = req.user.id;
            const { message, type = 'message' } = req.body;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                },
            });

            if (!user) {
                res.status(404).json({
                    status: 'error',
                    message: 'User not found',
                });
                return;
            }

            const chatMessage = {
                userId: user.id,
                userName: `${user.firstName} ${user.lastName}`,
                userAvatar: user.avatar,
                text: message,
                type,
            };

            await StreamingService.sendChatMessage(streamId, chatMessage);

            res.status(200).json({
                status: 'success',
                message: 'Chat message sent',
            });
        } catch (error) {
            next(error);
        }
    }

    static async likeStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const userId = req.user.id;

            // Check if already liked
            const existingLike = await prisma.sermonLike.findUnique({
                where: {
                    sermonId_userId: {
                        sermonId: streamId,
                        userId,
                    },
                },
            });

            if (existingLike) {
                res.status(400).json({
                    status: 'error',
                    message: 'Already liked this stream',
                });
                return;
            }

            // Add like
            await prisma.sermonLike.create({
                data: {
                    sermonId: streamId,
                    userId,
                },
            });

            // Update likes count
            await prisma.sermon.update({
                where: { id: streamId },
                data: { likes: { increment: 1 } },
            });

            res.status(200).json({
                status: 'success',
                message: 'Stream liked',
            });
        } catch (error) {
            next(error);
        }
    }

    static async submitQuestion(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const userId = req.user.id;
            const { question, isAnonymous = false } = req.body;

            const streamQuestion = await prisma.streamQuestion.create({
                data: {
                    sermonId: streamId,
                    userId: isAnonymous ? null : userId,
                    question,
                    isAnonymous,
                    status: 'PENDING',
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Question submitted',
                data: { question: streamQuestion },
            });
        } catch (error) {
            next(error);
        }
    }

    static async voteOnPoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, pollId } = req.params;
            const userId = req.user.id;
            const { optionId } = req.body;

            // Check if already voted
            const existingVote = await prisma.pollVote.findUnique({
                where: {
                    pollId_userId: {
                        pollId,
                        userId,
                    },
                },
            });

            if (existingVote) {
                res.status(400).json({
                    status: 'error',
                    message: 'Already voted on this poll',
                });
                return;
            }

            // Create vote
            await prisma.pollVote.create({
                data: {
                    pollId,
                    userId,
                    optionId,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Vote recorded',
            });
        } catch (error) {
            next(error);
        }
    }

    // Admin methods
    static async createStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const streamData = req.body;
            const userId = req.user.id;

            const result = await StreamingService.createLiveStream(
                streamData.title,
                streamData.description,
                streamData.scheduledStartTime ? new Date(streamData.scheduledStartTime) : undefined
            );

            // Update sermon with preacher info
            if (streamData.preacher || streamData.preacherId) {
                await prisma.sermon.update({
                    where: { id: result.sermonId },
                    data: {
                        preacher: streamData.preacher,
                        preacherId: streamData.preacherId,
                    },
                });
            }

            res.status(201).json({
                status: 'success',
                message: 'Stream created successfully',
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const streamData = req.body;

            const stream = await prisma.sermon.update({
                where: { id: streamId },
                data: {
                    ...streamData,
                    ...(streamData.scheduledStartTime && { date: new Date(streamData.scheduledStartTime) }),
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Stream updated successfully',
                data: { stream },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.findUnique({
                where: { id: streamId },
            });

            if (!stream) {
                res.status(404).json({
                    status: 'error',
                    message: 'Stream not found',
                });
                return;
            }

            // End stream if it's live
            if (stream.isLive && stream.liveStreamId) {
                await StreamingService.endLiveStream(stream.liveStreamId);
            }

            await prisma.sermon.delete({
                where: { id: streamId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Stream deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }

    static async startStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.update({
                where: { id: streamId },
                data: {
                    isLive: true,
                    date: new Date(),
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Stream started',
                data: { stream },
            });
        } catch (error) {
            next(error);
        }
    }

    static async endStream(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.update({
                where: { id: streamId },
                data: {
                    isLive: false,
                },
            });

            // End stream in streaming service
            if (stream.liveStreamId) {
                await StreamingService.endLiveStream(stream.liveStreamId);
            }

            res.status(200).json({
                status: 'success',
                message: 'Stream ended',
                data: { stream },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStreamConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const config = await prisma.streamConfig.findUnique({
                where: { sermonId: streamId },
            });

            res.status(200).json({
                status: 'success',
                data: { config },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateStreamConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const configData = req.body;

            let config = await prisma.streamConfig.findUnique({
                where: { sermonId: streamId },
            });

            if (config) {
                config = await prisma.streamConfig.update({
                    where: { sermonId: streamId },
                    data: configData,
                });
            } else {
                config = await prisma.streamConfig.create({
                    data: {
                        sermonId: streamId,
                        ...configData,
                    },
                });
            }

            res.status(200).json({
                status: 'success',
                message: 'Stream configuration updated',
                data: { config },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getModerationQueue(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { page = 1, limit = 20, status, type } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = { streamId };
            if (status) filter.status = status;
            if (type) filter.type = type;

            const total = await prisma.chatMessage.count({ where: filter });

            const messages = await prisma.chatMessage.findMany({
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
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    messages,
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

    static async moderateMessage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, messageId } = req.params;
            const { status, reason } = req.body;

            const message = await prisma.chatMessage.update({
                where: { id: messageId },
                data: { status, moderationReason: reason },
            });

            res.status(200).json({
                status: 'success',
                message: 'Message moderated',
                data: { message },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteMessage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, messageId } = req.params;

            await prisma.chatMessage.delete({
                where: { id: messageId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Message deleted',
            });
        } catch (error) {
            next(error);
        }
    }

    static async banUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { userId, reason, duration } = req.body;

            const ban = await prisma.streamBan.create({
                data: {
                    sermonId: streamId,
                    userId,
                    reason,
                    duration,
                    bannedBy: req.user.id,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'User banned',
                data: { ban },
            });
        } catch (error) {
            next(error);
        }
    }

    static async unbanUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { userId } = req.body;

            await prisma.streamBan.deleteMany({
                where: {
                    sermonId: streamId,
                    userId,
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'User unbanned',
            });
        } catch (error) {
            next(error);
        }
    }

    static async createPoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { question, options, isActive = true, duration } = req.body;

            const poll = await prisma.poll.create({
                data: {
                    sermonId: streamId,
                    question,
                    options: {
                        create: options.map((option: any, index: number) => ({
                            text: option.text,
                            order: index,
                        })),
                    },
                    isActive,
                    duration,
                },
                include: {
                    options: true,
                },
            });

            res.status(201).json({
                status: 'success',
                message: 'Poll created',
                data: { poll },
            });
        } catch (error) {
            next(error);
        }
    }

    static async updatePoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, pollId } = req.params;
            const updateData = req.body;

            const poll = await prisma.poll.update({
                where: { id: pollId },
                data: updateData,
            });

            res.status(200).json({
                status: 'success',
                message: 'Poll updated',
                data: { poll },
            });
        } catch (error) {
            next(error);
        }
    }

    static async deletePoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, pollId } = req.params;

            await prisma.poll.delete({
                where: { id: pollId },
            });

            res.status(200).json({
                status: 'success',
                message: 'Poll deleted',
            });
        } catch (error) {
            next(error);
        }
    }

    static async endPoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, pollId } = req.params;

            const poll = await prisma.poll.update({
                where: { id: pollId },
                data: {
                    isActive: false,
                    endedAt: new Date(),
                },
            });

            res.status(200).json({
                status: 'success',
                message: 'Poll ended',
                data: { poll },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPollResults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, pollId } = req.params;

            const poll = await prisma.poll.findUnique({
                where: { id: pollId },
                include: {
                    options: {
                        include: {
                            votes: {
                                include: {
                                    user: {
                                        select: {
                                            id: true,
                                            firstName: true,
                                            lastName: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            if (!poll) {
                res.status(404).json({
                    status: 'error',
                    message: 'Poll not found',
                });
                return;
            }

            const results = poll.options.map(option => ({
                id: option.id,
                text: option.text,
                votes: option.votes.length,
                voters: option.votes.map(vote => ({
                    userId: vote.userId,
                    name: `${vote.user.firstName} ${vote.user.lastName}`,
                })),
            }));

            res.status(200).json({
                status: 'success',
                data: {
                    question: poll.question,
                    results,
                    totalVotes: results.reduce((sum, option) => sum + option.votes, 0),
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getQuestions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;
            const { page = 1, limit = 20, status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = { sermonId: streamId };
            if (status) filter.status = status;

            const total = await prisma.streamQuestion.count({ where: filter });

            const questions = await prisma.streamQuestion.findMany({
                where: filter,
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
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    questions,
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

    static async updateQuestion(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId, questionId } = req.params;
            const { status, answer } = req.body;

            const question = await prisma.streamQuestion.update({
                where: { id: questionId },
                data: { status, answer },
            });

            res.status(200).json({
                status: 'success',
                message: 'Question updated',
                data: { question },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStreamAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const [
                stream,
                totalViews,
                peakViewers,
                chatMessages,
                questions,
                polls,
                likes,
            ] = await Promise.all([
                prisma.sermon.findUnique({
                    where: { id: streamId },
                    select: {
                        id: true,
                        title: true,
                        views: true,
                        likes: true,
                        date: true,
                        duration: true,
                    },
                }),
                prisma.sermonView.count({ where: { sermonId: streamId } }),
                // Peak viewers would come from Redis/streaming service
                prisma.chatMessage.count({ where: { streamId } }),
                prisma.streamQuestion.count({ where: { sermonId: streamId } }),
                prisma.poll.count({ where: { sermonId: streamId } }),
                prisma.sermonLike.count({ where: { sermonId: streamId } }),
            ]);

            const analytics = {
                stream,
                totalViews,
                peakViewers: 0, // Would come from streaming service
                chatMessages,
                questions,
                polls,
                likes,
                engagementRate: totalViews > 0 ? Math.round((chatMessages / totalViews) * 100) : 0,
            };

            res.status(200).json({
                status: 'success',
                data: { analytics },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getStreamingAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { startDate, endDate, groupBy = 'month' } = req.query;

            const filter: any = {};
            if (startDate || endDate) {
                filter.date = {};
                if (startDate) filter.date.gte = new Date(startDate as string);
                if (endDate) filter.date.lte = new Date(endDate as string);
            }

            const streams = await prisma.sermon.findMany({
                where: {
                    ...filter,
                    isLive: true,
                },
                select: {
                    id: true,
                    title: true,
                    date: true,
                    views: true,
                    likes: true,
                    duration: true,
                },
                orderBy: { date: 'desc' },
            });

            // Group by time period
            const groupedData = streams.reduce((acc, stream) => {
                let key: string;
                const date = new Date(stream.date);

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
                    acc[key] = {
                        streams: 0,
                        totalViews: 0,
                        totalLikes: 0,
                        totalDuration: 0,
                    };
                }

                acc[key].streams += 1;
                acc[key].totalViews += stream.views;
                acc[key].totalLikes += stream.likes;
                acc[key].totalDuration += stream.duration || 0;

                return acc;
            }, {} as Record<string, any>);

            const analytics = {
                totalStreams: streams.length,
                totalViews: streams.reduce((sum, stream) => sum + stream.views, 0),
                totalLikes: streams.reduce((sum, stream) => sum + stream.likes, 0),
                averageViews: streams.length > 0
                    ? Math.round(streams.reduce((sum, stream) => sum + stream.views, 0) / streams.length)
                    : 0,
                groupedData: Object.entries(groupedData).map(([period, data]) => ({
                    period,
                    ...data,
                    averageDuration: data.streams > 0 ? Math.round(data.totalDuration / data.streams) : 0,
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

    static async getIngestInfo(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { streamId } = req.params;

            const stream = await prisma.sermon.findUnique({
                where: { id: streamId },
                select: {
                    liveStreamId: true,
                },
            });

            if (!stream || !stream.liveStreamId) {
                res.status(404).json({
                    status: 'error',
                    message: 'Stream not found or not configured for live streaming',
                });
                return;
            }

            // Get ingest info from streaming service
            const ingestInfo = {
                rtmpUrl: process.env.RTMP_URL || 'rtmp://your-stream-server/live',
                streamKey: stream.liveStreamId,
                backupRtmpUrl: process.env.BACKUP_RTMP_URL,
                ingestInstructions: 'Use OBS, Streamlabs, or similar software to stream to this URL',
            };

            res.status(200).json({
                status: 'success',
                data: { ingestInfo },
            });
        } catch (error) {
            next(error);
        }
    }
}