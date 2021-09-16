import path from 'path';

export class ServerConfig {
    static loadConfigPath() {
        return path.resolve(__dirname, '../server-config.json');
    }
}
