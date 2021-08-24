import path from 'path';

export class ServerConfig {
    constructor(){
    }

    loadConfigPath(){
        return path.resolve(__dirname, '../server-config.json');
    }

}
