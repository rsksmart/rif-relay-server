import { Request } from 'express';

export type RootHandlerRequest = Request & {
    body?: {
        id: string;
        method: string;
        params: Array<unknown>;
    };
};
