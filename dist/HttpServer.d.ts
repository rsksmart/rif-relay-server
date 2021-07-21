import { Express, Request, Response } from 'express';
import { RelayServer } from './RelayServer';
export declare class HttpServer {
    private readonly port;
    readonly backend: RelayServer;
    app: Express;
    private serverInstance?;
    constructor(port: number, backend: RelayServer);
    start(): void;
    startBackend(): void;
    stop(): void;
    close(): void;
    rootHandler(req: any, res: any): Promise<void>;
    pingHandler(req: Request, res: Response): Promise<void>;
    statusHandler(req: any, res: any): void;
    relayHandler(req: Request, res: Response): Promise<void>;
    tokenHandler(req: Request, res: Response): Promise<void>;
    verifierHandler(req: Request, res: Response): Promise<void>;
}
