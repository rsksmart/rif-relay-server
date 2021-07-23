import { CommandClient } from "./helpers/CommandClient";
import { EnvelopingConfig } from "@rsksmart/rif-relay-common";
import BN from "bn.js";
interface RegisterOptions {
    hub: string;
    from: string;
    gasPrice: string | BN;
    stake: string | BN;
    funds: string | BN;
    relayUrl: string;
    unstakeDelay: string;
}
export declare class Register extends CommandClient {
    constructor(host: string, config: EnvelopingConfig, mnemonic?: string);
    execute(options: RegisterOptions): Promise<void>;
}
export {};
