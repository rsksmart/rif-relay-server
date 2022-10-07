# RIF Relay Server

This typescript repository contains all the server code used by the RIF Relay System.

This project works as a dependency as well as a stand-alone project.

## Table of Contents

- [**Installation**](#installation)
  - [**Pre-requisites**](#pre-requisites)
  - [**Dependencies**](#dependencies)
- [**System usage**](#system-usage)
  - [**Server execution**](#server-execution)
  - [**Server registration**](#server-registration)
- [**Execute using Docker**](#execute-as-a-docker-container)
- [**Library usage**](#library-usage)
  - [**Use a release version**](#use-a-release-version)
  - [**Use the repo distributable**](#use-the-repo-distributable)
  - [**Use a local distributable**](#use-a-local-distributable)
- [**Development**](#development)
  - [**Enabling postinstall scripts**](#enabling-postinstall-scripts)
  - [**Husky and linters**](#husky-and-linters)
  - [**Generating a new distributable version**](#generating-a-new-distributable-version)
    - [**For GitHub**](#for-github)
    - [**For NPM**](#for-npm)
    - [**For direct use (no publishing)**](#for-direct-use-no-publishing)

## Installation

### Pre-requisites

- Node version 16.x
- RSKj Running Node.
  - **Note: To work properly with this server in Regtest, please use the RSKj configuration that can be found [here](https://github.com/rsksmart/rif-relay/blob/master/rsknode/node.conf).**
- [RIF Relay Contracts](https://github.com/anarancio/rif-relay-contracts) deployed

### Dependencies

Just run `npm install` to install all dependencies.

## System usage

### Server execution

You can use this repository directly to start your server.

To start the relay server, you need to configure the `server-config.json` file, which has this structure:

```json
{
  "url": "localhost",
  "port": 8090,
  "relayHubAddress": "0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701",
  "relayVerifierAddress": "0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2",
  "deployVerifierAddress": "0x1938517B0762103d52590Ca21d459968c25c9E67",
  "gasPriceFactor": 1,
  "rskNodeUrl": "http://rsk-node:4444",
  "devMode": true,
  "customReplenish": false,
  "logLevel": 1,
  "workdir": "/home/user/workspace/relay",
  "feePercentage": "0.01" // 1 = 100%
}
```

Where:

- **url**: is the URL where the relay server will be deployed, it could be localhost or the IP of the host machine.
- **port**: the port where the relay server will be hosted.
- **relayHubAddress**: is the relay hub contract address, you can retrieve this from the contract summary.
- **relayVerifierAddress**: is the relay verifier contract address, you can retrieve this from the contract summary.
- **deployVerifierAddress**: is the deploy verifier contract address, you can retrieve this from the contract summary.
- **gasPriceFactor**: is the gas price factor used to calculate the gas on the server, you can leave it as 1.
- **rskNodeUrl**: is the RSK node endpoint URL, where the RSK node is located.
- **devMode**: it indicates to the server if we are in development mode or not.
- **customReplenish**: set if the server uses a custom replenish function or not.
- **logLevel**: is the log level for the relay server.
- **workdir**: is the absolute path to the folder where the server will store the database and all its data.
- **feePercentage**: allows revenue sharing feature and sets the fee value (%) that the worker will take from all transactions.
   - the fee will be added to the estimated gas and required in the transaction amount.
   - the percentage is represented as a fraction (1 = 100%) string to allow for very low or high percentages
   - the minus sign is omitted if used
   - fractions exceeding the number of decimals of that of the native currency will be rounded up

Afterwards, run the following command:

```bash
npm run start -- -c "<PATH>"
```

The long options command is also available on Linux:

```bash
npm run start -- --config_file="<PATH>"
```

where:

- **CONFIG_FILE**: an optional path to an alternative configuration file. If not specified, the server will be started using server-config.json.

The command shows its usage with the `-h` parameter:

```bash
npm run start -- -h
```

You can browse the `getAddr` endpoint (e.g. by doing `curl` to `http://localhost:8090/getaddr`) to verify the server is running correctly as well as visualize some useful information:

```json
{
  "relayWorkerAddress": "0xe722143177fe9c7c58057dc3d98d87f6c414dc95",
  "relayManagerAddress": "0xe0820002dfaa69cbf8add6a738171e8eb0a5ee54",
  "relayHubAddress": "0x38bebd507aBC3D76B10d61f5C95668e1240D087F",
  "minGasPrice": "6000000000",
  "chainId": "31",
  "networkId": "31",
  "ready": false,
  "version": "2.0.1"
}
```

If it's the first time the server is run, some logs will state that the server isn't ready and that some values are wrong. This is expected, you just need to register the server on the relay hub in order for it to be usable by the clients.

### Server registration

Once the relay server is up, you need to register it in order for it to be usable.

Run the following command:

```bash
npm run register -- -f "<FUNDS>" -s "<STAKE>" -a "<ACCOUNT>" -m "<MNEMONIC>" -c "<PATH>"
```

The long options command is also available on Linux:

```bash
npm run register -- --funds="<FUNDS>" --stake="<STAKE>" --account="<ACCOUNT>" --mnemonic="<MNEMONIC>" --config_file="<PATH>"
```

where:

- **FUNDS**: an optional amount of funds to set up (by default 10)
- **STAKE**: an optional the amount of stake to set up (by default 20)
- **ACCOUNT**: an optional account to use for funding and staking (it requires the mnemonic parameter)
- **MNEMONIC**: an optional mnemonic to use for unlocking the account parameter (it requires the account parameter)
- **CONFIG_FILE**: an optional path to an alternative configuration file. If not specified, the server will be registered using server-config.json.

The command shows its usage with the `-h` parameter:

```bash
npm run register -- -h
```

After this you will be seeing several log entries indicating how everything is turning out. After a little while, look for this entry in the relay server execution terminal to make sure that the server is ready:

```
Relayer state: READY
```

## Execute as a Docker container

You can run the server as a Docker container. Docker and Docker compose should be installed and an RSK Node should be running.
After modifying the config-file as indicated [here](#server-execution), an additional modification should be made in the same file as follows:

For Mac users:
```json
"rskNodeUrl": "http://host.docker.internal:4444",
```

For Linux users:
```json
"rskNodeUrl": "http://172.17.0.1:4444",
```

In both cases, edit your local hosts file to make the address above resolve as 127.0.0.1. Then run 

```bash
docker-compose build && docker-compose up
```

After that, continue with the [server registration](#server-registration).

## Library usage

You can use this dependency once you have it installed on your project. There are multiple ways to do this:

### Use a release version

Install with:

```bash
npm i --save @rsksmart/rif-relay-server
```

### Use a local distributable

Clone this repository inside your project's root folder and use the `npm link` mechanism (https://docs.npmjs.com/cli/v8/commands/npm-link) to add it to your project.

## Development

Make your modifications and then run `npm run build` to validate them.
When you are done with your changes, you can publish them by creating a distributable version.

### Testing
The relay server scripts define three testing strategies:

1. `test:unit` - runs one-off unit tests within the `./test/unit/` directory
2. `test:integration` - runs one-off integration tests within the `./test/integration` directory
3. `tdd` - runs unit tests in watch mode. Watches all **ts** files in the project

In addition, the `TRACE_LOG=true` environment variable may be used to use the trace log level in the tests `;]`. This will print a lot of logs from the codebase.

### Husky and linters

We use husky to check linters and code styles on commits, if you commit your
changes and the commit fails on lint or prettier checks you can use these command
to check and fix the errors before trying to commit again:

- `npm run lint`: to check linter bugs
- `npm run lint:fix`: to fix linter bugs
- `npm run prettier`: to check code-style errors
- `npm run prettier:fix`: to fix code-style errors

## ts-node

In order to run the server without having to rebuild every time a change is made, use the following command:

- `npm run debug`: run the server with ts-node

### Generating a new distributable version

1. Run the `npm run build` command to generate the `dist` folder with the distributable version inside.
2. Bump the version on the `package.json` file (not strictly needed).
3. Commit and push any changes, including the version bump.

#### For GitHub

1. Create a new tag with the new version (from `package.json`) and GitHub actions will update NPM

#### For NPM

1. Run `npm login` to log in to your account on the NPM registry.
2. Run `npm publish` to generate the distributable version for NodeJS.

#### For direct use (no publishing)

No extra steps are needed beyond generating the `dist` folder and merging it to `master`.
