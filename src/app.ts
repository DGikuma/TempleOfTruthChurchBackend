import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import { Server } from 'socket.io';
import http from 'http';
import config from './config';
import logger from './utils/logger';
import errorHandler from './middleware/errorHandler';
import connectDB from './config/database';
import routes from './routes';

class App {
    public app: express.Application;
    public server: http.Server;
    public io: Server;
    private port: number;

    constructor() {
        this.app = express();
        this.port = config.port;
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: config.corsOrigins,
                credentials: true,
            },
        });

        this.initializeDatabase();
        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
        this.initializeSocketIO();
        this.initializeBackgroundJobs();
    }

    private async initializeDatabase(): Promise<void> {
        await connectDB();
        logger.info('Database connected successfully');
    }

    private initializeMiddleware(): void {
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors({
            origin: config.corsOrigins,
            credentials: true,
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: config.rateLimitWindow * 60 * 1000,
            max: config.rateLimitMax,
            message: 'Too many requests from this IP, please try again later.',
        });
        this.app.use('/api', limiter);

        // Body parsers
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use(cookieParser(config.cookieSecret));

        // Data sanitization
        this.app.use(mongoSanitize());
        this.app.use(xss());
        this.app.use(hpp());

        // Compression
        this.app.use(compression());

        // Logging
        this.app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

        // Static files
        this.app.use('/uploads', express.static('uploads'));
        this.app.use('/media', express.static('media'));

        // Request logging
        this.app.use((req, res, next) => {
            req.startTime = Date.now();
            logger.info(`${req.method} ${req.url}`);
            next();
        });
    }

    private initializeRoutes(): void {
        this.app.use('/api', routes);

        // Health check
        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'success',
                message: 'Server is running',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
            });
        });

        // 404 handler
        this.app.all('*', (req, res) => {
            res.status(404).json({
                status: 'error',
                message: `Can't find ${req.originalUrl} on this server!`,
            });
        });
    }

    private initializeErrorHandling(): void {
        this.app.use(errorHandler);
    }

    private initializeSocketIO(): void {
        this.io.on('connection', (socket) => {
            logger.info(`Socket connected: ${socket.id}`);

            // Join live stream room
            socket.on('join-stream', (streamId: string) => {
                socket.join(`stream-${streamId}`);
                logger.info(`Socket ${socket.id} joined stream ${streamId}`);

                // Notify others
                socket.to(`stream-${streamId}`).emit('viewer-joined', {
                    viewerCount: this.io.sockets.adapter.rooms.get(`stream-${streamId}`)?.size || 0,
                });
            });

            // Live chat messages
            socket.on('chat-message', (data: { streamId: string; message: string; user: any }) => {
                this.io.to(`stream-${streamId}`).emit('new-message', {
                    ...data,
                    timestamp: new Date().toISOString(),
                });
            });

            // Prayer request notifications
            socket.on('join-prayer-room', (roomId: string) => {
                socket.join(`prayer-${roomId}`);
            });

            // Real-time analytics
            socket.on('track-event', (data: any) => {
                // Log analytics events
                logger.info(`Analytics event: ${JSON.stringify(data)}`);
            });

            socket.on('disconnect', () => {
                logger.info(`Socket disconnected: ${socket.id}`);
            });
        });
    }

    private initializeBackgroundJobs(): void {
        // Import job scheduler
        import('./services/cronJobs').then(({ startCronJobs }) => {
            startCronJobs();
            logger.info('Background jobs started');
        });
    }

    public listen(): void {
        this.server.listen(this.port, () => {
            logger.info(`Server running in ${config.nodeEnv} mode on port ${this.port}`);
            logger.info(`API Documentation: ${config.backendUrl}/api-docs`);
        });
    }
}

// Create and start the application
const app = new App();
app.listen();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
    logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
    logger.error(err.name, err.message, err.stack);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
    logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    logger.error(err.name, err.message, err.stack);
    process.exit(1);
});

export default app;