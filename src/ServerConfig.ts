import path from 'path';

export class ServerConfig {
    constructor(){
    }

    static loadConfigPath(){
        return path.resolve(__dirname, '../server-config.json');
    }

}
