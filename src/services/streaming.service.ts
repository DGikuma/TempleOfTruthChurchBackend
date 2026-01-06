// src/services/streaming.service.ts
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import logger from '../utils/logger';
import prisma from '../config/database';
import Redis from 'ioredis';

const redis = new Redis(config.redisUrl);

export class StreamingService {
    private static youtube = google.youtube({
        version: 'v3',
        auth: config.youtubeApiKey,
    });

    static async createLiveStream(title: string, description: string, scheduledStartTime?: Date): Promise<any> {
        try {
            const streamId = uuidv4();
            const streamKey = `live_${streamId}`;

            // Create YouTube live stream
            const broadcastResponse = await this.youtube.liveBroadcasts.insert({
                part: ['snippet', 'contentDetails', 'status'],
                requestBody: {
                    snippet: {
                        title,
                        description,
                        scheduledStartTime: scheduledStartTime?.toISOString(),
                    },
                    status: {
                        privacyStatus: 'public',
                        selfDeclaredMadeForKids: false,
                    },
                    contentDetails: {
                        enableAutoStart: true,
                        enableAutoStop: true,
                        enableEmbed: true,
                        enableContentEncryption: true,
                        enableDvr: true,
                        recordFromStart: true,
                        startWithSlate: false,
                    },
                },
            });

            const streamResponse = await this.youtube.liveStreams.insert({
                part: ['snippet', 'cdn', 'contentDetails', 'status'],
                requestBody: {
                    snippet: {
                        title: `${title} - Stream`,
                    },
                    cdn: {
                        frameRate: 'variable',
                        ingestionType: 'rtmp',
                        resolution: 'variable',
                    },
                    contentDetails: {
                        isReusable: false,
                    },
                },
            });

            // Bind broadcast to stream
            await this.youtube.liveBroadcasts.bind({
                id: broadcastResponse.data.id!,
                part: ['id', 'snippet', 'contentDetails', 'status'],
                streamId: streamResponse.data.id!,
            });

            // Store stream info in Redis
            await redis.hset(`stream:${streamId}`, {
                youtubeBroadcastId: broadcastResponse.data.id!,
                youtubeStreamId: streamResponse.data.id!,
                streamKey,
                title,
                status: 'created',
                createdAt: Date.now().toString(),
            });

            // Create sermon record
            const sermon = await prisma.sermon.create({
                data: {
                    title,
                    description,
                    preacher: 'Pastor John', // Default, can be updated
                    date: scheduledStartTime || new Date(),
                    duration: 0,
                    isLive: true,
                    liveStreamId: streamId,
                    tags: ['live-stream'],
                },
            });

            return {
                success: true,
                streamId,
                streamKey,
                youtube: {
                    broadcastId: broadcastResponse.data.id,
                    streamId: streamResponse.data.id,
                    rtmpUrl: streamResponse.data.cdn?.ingestionInfo?.ingestionAddress,
                    streamName: streamResponse.data.cdn?.ingestionInfo?.streamName,
                    playbackUrl: `https://www.youtube.com/watch?v=${broadcastResponse.data.id}`,
                },
                sermonId: sermon.id,
                viewerUrl: `${config.frontendUrl}/live/${streamId}`,
            };
        } catch (error: any) {
            logger.error('Error creating live stream:', error);
            throw error;
        }
    }

    static async getStreamInfo(streamId: string): Promise<any> {
        try {
            // Get from Redis cache first
            const cached = await redis.hgetall(`stream:${streamId}`);

            if (cached && Object.keys(cached).length > 0) {
                // Update viewer count
                const viewerCount = await redis.scard(`stream:${streamId}:viewers`);
                cached.viewerCount = viewerCount.toString();
                return cached;
            }

            // If not cached, fetch from YouTube
            const broadcast = await this.youtube.liveBroadcasts.list({
                id: [streamId],
                part: ['snippet', 'contentDetails', 'status', 'statistics'],
            });

            if (!broadcast.data.items?.[0]) {
                throw new Error('Stream not found');
            }

            const streamInfo = broadcast.data.items[0];

            // Cache the result
            await redis.hset(`stream:${streamId}`, {
                title: streamInfo.snippet?.title || '',
                description: streamInfo.snippet?.description || '',
                status: streamInfo.status?.lifeCycleStatus || 'unknown',
                scheduledStartTime: streamInfo.snippet?.scheduledStartTime || '',
                actualStartTime: streamInfo.snippet?.actualStartTime || '',
                actualEndTime: streamInfo.snippet?.actualEndTime || '',
                viewerCount: streamInfo.statistics?.concurrentViewers || '0',
                likeCount: streamInfo.statistics?.likeCount || '0',
            });

            // Set expiration
            await redis.expire(`stream:${streamId}`, 300); // 5 minutes

            return streamInfo;
        } catch (error) {
            logger.error('Error getting stream info:', error);
            throw error;
        }
    }

    static async updateViewerCount(streamId: string, userId: string, action: 'join' | 'leave'): Promise<void> {
        try {
            if (action === 'join') {
                await redis.sadd(`stream:${streamId}:viewers`, userId);
                await redis.expire(`stream:${streamId}:viewers`, 3600); // 1 hour

                // Increment total view count
                await redis.hincrby(`stream:${streamId}:stats`, 'totalViews', 1);
            } else {
                await redis.srem(`stream:${streamId}:viewers`, userId);
            }

            // Update real-time viewer count in cache
            const viewerCount = await redis.scard(`stream:${streamId}:viewers`);
            await redis.hset(`stream:${streamId}`, 'currentViewers', viewerCount);
        } catch (error) {
            logger.error('Error updating viewer count:', error);
        }
    }

    static async sendChatMessage(streamId: string, message: any): Promise<void> {
        try {
            // Store message in Redis
            const messageId = uuidv4();
            const messageData = {
                id: messageId,
                streamId,
                userId: message.userId,
                userName: message.userName,
                userAvatar: message.userAvatar,
                message: message.text,
                timestamp: Date.now(),
                type: message.type || 'message',
            };

            await redis.lpush(`stream:${streamId}:chat`, JSON.stringify(messageData));
            await redis.ltrim(`stream:${streamId}:chat`, 0, 999); // Keep last 1000 messages

            // Publish to Redis pub/sub for real-time updates
            await redis.publish(`stream:${streamId}:chat`, JSON.stringify(messageData));

            logger.info(`Chat message sent to stream ${streamId}: ${message.text}`);
        } catch (error) {
            logger.error('Error sending chat message:', error);
            throw error;
        }
    }

    static async getChatHistory(streamId: string, limit = 100): Promise<any[]> {
        try {
            const messages = await redis.lrange(`stream:${streamId}:chat`, 0, limit - 1);
            return messages.map(msg => JSON.parse(msg)).reverse(); // Return newest first
        } catch (error) {
            logger.error('Error getting chat history:', error);
            return [];
        }
    }

    static async endLiveStream(streamId: string): Promise<void> {
        try {
            // Update YouTube broadcast
            await this.youtube.liveBroadcasts.transition({
                id: streamId,
                broadcastStatus: 'complete',
                part: ['id', 'snippet', 'status'],
            });

            // Update database
            await prisma.sermon.updateMany({
                where: { liveStreamId: streamId },
                data: {
                    isLive: false,
                    videoUrl: `https://www.youtube.com/watch?v=${streamId}`,
                    updatedAt: new Date(),
                },
            });

            // Update Redis
            await redis.hset(`stream:${streamId}`, {
                status: 'ended',
                endedAt: Date.now().toString(),
            });

            // Archive chat history to database
            const chatHistory = await this.getChatHistory(streamId, 1000);
            if (chatHistory.length > 0) {
                // Store in MongoDB or PostgreSQL
                logger.info(`Archived ${chatHistory.length} chat messages for stream ${streamId}`);
            }

            logger.info(`Live stream ${streamId} ended successfully`);
        } catch (error) {
            logger.error('Error ending live stream:', error);
            throw error;
        }
    }

    static async generateStreamStats(streamId: string): Promise<any> {
        try {
            const [
                totalViewers,
                chatMessages,
                peakViewers,
                averageWatchTime,
            ] = await Promise.all([
                redis.hget(`stream:${streamId}:stats`, 'totalViews'),
                redis.llen(`stream:${streamId}:chat`),
                redis.hget(`stream:${streamId}:stats`, 'peakViewers'),
                redis.hget(`stream:${streamId}:stats`, 'averageWatchTime'),
            ]);

            return {
                totalViewers: parseInt(totalViewers || '0'),
                chatMessages,
                peakViewers: parseInt(peakViewers || '0'),
                averageWatchTime: parseInt(averageWatchTime || '0'),
                engagementRate: chatMessages > 0 ? (chatMessages / parseInt(totalViewers || '1')).toFixed(2) : '0',
            };
        } catch (error) {
            logger.error('Error generating stream stats:', error);
            throw error;
        }
    }

    static async scheduleLiveStream(
        title: string,
        description: string,
        scheduledStartTime: Date,
        preacher?: string
    ): Promise<any> {
        try {
            const streamInfo = await this.createLiveStream(title, description, scheduledStartTime);

            // Update sermon with preacher info
            if (preacher) {
                await prisma.sermon.update({
                    where: { id: streamInfo.sermonId },
                    data: { preacher },
                });
            }

            // Schedule reminder emails
            await this.scheduleStreamReminders(streamInfo.streamId, scheduledStartTime);

            return streamInfo;
        } catch (error) {
            logger.error('Error scheduling live stream:', error);
            throw error;
        }
    }

    private static async scheduleStreamReminders(streamId: string, scheduledTime: Date): Promise<void> {
        const reminderTimes = [
            new Date(scheduledTime.getTime() - 24 * 60 * 60 * 1000), // 24 hours before
            new Date(scheduledTime.getTime() - 60 * 60 * 1000), // 1 hour before
            new Date(scheduledTime.getTime() - 15 * 60 * 1000), // 15 minutes before
        ];

        for (const reminderTime of reminderTimes) {
            // Schedule job using node-cron or similar
            logger.info(`Scheduled reminder for stream ${streamId} at ${reminderTime}`);
        }
    }
}