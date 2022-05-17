"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyManager = exports.KEYSTORE_FILENAME = void 0;
const ethereumjs_wallet_1 = __importStar(require("ethereumjs-wallet"));
const fs_1 = __importDefault(require("fs"));
const ow_1 = __importDefault(require("ow"));
const web3_utils_1 = require("web3-utils");
const loglevel_1 = __importDefault(require("loglevel"));
exports.KEYSTORE_FILENAME = 'keystore';
class KeyManager {
    /**
     * @param count - # of addresses managed by this manager
     * @param workdir - read seed from keystore file (or generate one and write it)
     * @param seed - if working in memory (no workdir), you can specify a seed - or use randomly generated one.
     */
    constructor(count, workdir, seed) {
        this._privateKeys = {};
        this.nonces = {};
        ow_1.default(count, ow_1.default.number);
        if (seed != null && workdir != null) {
            throw new Error("Can't specify both seed and workdir");
        }
        if (workdir != null) {
            // @ts-ignore
            try {
                if (!fs_1.default.existsSync(workdir)) {
                    fs_1.default.mkdirSync(workdir, { recursive: true });
                }
                let genseed;
                const keyStorePath = workdir + '/' + exports.KEYSTORE_FILENAME;
                if (fs_1.default.existsSync(keyStorePath)) {
                    genseed = Buffer.from(JSON.parse(fs_1.default.readFileSync(keyStorePath).toString())
                        .seed, 'hex');
                }
                else {
                    genseed = ethereumjs_wallet_1.default.generate().getPrivateKey();
                    fs_1.default.writeFileSync(keyStorePath, JSON.stringify({ seed: genseed.toString('hex') }), { flag: 'w' });
                }
                this.hdkey = ethereumjs_wallet_1.hdkey.fromMasterSeed(genseed);
            }
            catch (e) {
                if (e instanceof Error &&
                    !e.message.includes('file already exists')) {
                    throw e;
                }
                else {
                    loglevel_1.default.error(e);
                }
            }
        }
        else {
            // no workdir: working in-memory
            if (seed == null) {
                seed = ethereumjs_wallet_1.default.generate().getPrivateKey();
            }
            this.hdkey = ethereumjs_wallet_1.hdkey.fromMasterSeed(seed !== null && seed !== void 0 ? seed : Buffer.from(''));
        }
        this.generateKeys(count);
    }
    generateKeys(count) {
        this._privateKeys = {};
        this.nonces = {};
        for (let index = 0; index < count; index++) {
            const w = this.hdkey.deriveChild(index).getWallet();
            const address = web3_utils_1.toHex(w.getAddress());
            this._privateKeys[address] = w.getPrivateKey();
            this.nonces[index] = 0;
        }
    }
    getAddress(index) {
        return this.getAddresses()[index];
    }
    getAddresses() {
        return Object.keys(this._privateKeys);
    }
    isSigner(signer) {
        return this._privateKeys[signer] != null;
    }
    signTransaction(signer, tx) {
        ow_1.default(signer, ow_1.default.string);
        const privateKey = this._privateKeys[signer];
        if (privateKey === undefined) {
            throw new Error(`Can't sign: signer=${signer} is not managed`);
        }
        tx.sign(privateKey);
        const rawTx = '0x' + tx.serialize().toString('hex');
        return rawTx;
    }
}
exports.KeyManager = KeyManager;
//# sourceMappingURL=KeyManager.js.map