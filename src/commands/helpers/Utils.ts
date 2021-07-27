import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ServerConfigParams } from '../../ServerConfigParams';
import * as fs from 'fs';

export function getParams(): any {
    return yargs(hideBin(process.argv)).argv;
}

export function parseServerConfig(configFile: string): ServerConfigParams {
    const configJson = JSON.parse(
        fs.readFileSync(configFile, { encoding: 'utf8' })
    );
    return configJson as ServerConfigParams;
}
